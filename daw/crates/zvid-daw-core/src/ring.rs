//! Wait-free single-producer, single-consumer ring.
//!
//! The audio thread pushes transport snapshots and the control thread pops
//! them. Neither side allocates, locks or blocks: a push into a full ring is
//! dropped and reported, so a stalled consumer never stalls audio.

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::tracker::TransportSnapshot;

/// Default capacity of [`transport_ring`]: a few seconds of snapshots at one
/// per audio block with small buffers.
pub const TRANSPORT_RING_CAPACITY: usize = 1024;

struct Shared<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    /// Next slot the consumer reads. Only the consumer stores it.
    head: AtomicUsize,
    /// Next slot the producer writes. Only the producer stores it.
    tail: AtomicUsize,
}

// SAFETY: a slot is only written by the producer while it is outside
// `head..tail` and only read by the consumer while it is inside, and the
// acquire/release pairs on `head`/`tail` order those accesses.
unsafe impl<T: Send> Sync for Shared<T> {}

/// Creates a ring holding up to `capacity` items.
pub fn ring<T: Copy + Send>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    assert!(capacity > 0, "ring capacity must be positive");
    // One slot stays empty so a full ring is distinguishable from an empty one.
    let slots = (0..=capacity)
        .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
        .collect();
    let shared = Arc::new(Shared {
        slots,
        head: AtomicUsize::new(0),
        tail: AtomicUsize::new(0),
    });
    (
        Producer {
            shared: Arc::clone(&shared),
        },
        Consumer { shared },
    )
}

/// A ring carrying transport snapshots from the audio thread.
pub fn transport_ring() -> (Producer<TransportSnapshot>, Consumer<TransportSnapshot>) {
    ring(TRANSPORT_RING_CAPACITY)
}

/// The writing half. Owned by the audio thread.
pub struct Producer<T> {
    shared: Arc<Shared<T>>,
}

impl<T: Copy + Send> Producer<T> {
    /// Appends `item`, or returns `false` and drops it when the ring is full.
    pub fn push(&mut self, item: T) -> bool {
        let shared = &*self.shared;
        let tail = shared.tail.load(Ordering::Relaxed);
        let next = (tail + 1) % shared.slots.len();
        if next == shared.head.load(Ordering::Acquire) {
            return false;
        }
        // SAFETY: `tail` is outside `head..tail`, so the consumer is not
        // reading it, and only this producer writes slots.
        unsafe { (*shared.slots[tail].get()).write(item) };
        shared.tail.store(next, Ordering::Release);
        true
    }
}

/// The reading half. Owned by the control thread.
pub struct Consumer<T> {
    shared: Arc<Shared<T>>,
}

impl<T: Copy + Send> Consumer<T> {
    /// Removes and returns the oldest item.
    pub fn pop(&mut self) -> Option<T> {
        let shared = &*self.shared;
        let head = shared.head.load(Ordering::Relaxed);
        if head == shared.tail.load(Ordering::Acquire) {
            return None;
        }
        // SAFETY: `head` is inside `head..tail`, so the producer wrote it
        // (published by the acquire above) and will not touch it until the
        // store below releases it.
        let item = unsafe { (*shared.slots[head].get()).assume_init() };
        shared
            .head
            .store((head + 1) % shared.slots.len(), Ordering::Release);
        Some(item)
    }

    /// Removes every queued item, oldest first.
    pub fn drain(&mut self) -> impl Iterator<Item = T> + '_ {
        std::iter::from_fn(|| self.pop())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pops_in_push_order() {
        let (mut tx, mut rx) = ring(4);
        assert_eq!(rx.pop(), None);
        assert!(tx.push(1));
        assert!(tx.push(2));
        assert_eq!(rx.pop(), Some(1));
        assert!(tx.push(3));
        assert_eq!(rx.drain().collect::<Vec<_>>(), [2, 3]);
        assert_eq!(rx.pop(), None);
    }

    #[test]
    fn drops_pushes_into_a_full_ring() {
        let (mut tx, mut rx) = ring(2);
        assert!(tx.push(1));
        assert!(tx.push(2));
        assert!(!tx.push(3));
        assert_eq!(rx.pop(), Some(1));
        assert!(tx.push(4));
        assert_eq!(rx.drain().collect::<Vec<_>>(), [2, 4]);
    }

    #[test]
    fn wraps_around_many_times() {
        let (mut tx, mut rx) = ring(3);
        for i in 0..100 {
            assert!(tx.push(i));
            assert_eq!(rx.pop(), Some(i));
        }
    }

    #[test]
    fn carries_items_across_threads_in_order() {
        let (mut tx, mut rx) = ring(16);
        let producer = std::thread::spawn(move || {
            for i in 0..10_000u32 {
                while !tx.push(i) {
                    std::thread::yield_now();
                }
            }
        });
        let mut expected = 0;
        while expected < 10_000 {
            if let Some(item) = rx.pop() {
                assert_eq!(item, expected);
                expected += 1;
            } else {
                std::thread::yield_now();
            }
        }
        producer.join().unwrap();
    }
}
