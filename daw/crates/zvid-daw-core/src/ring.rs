//! Lock-free single-producer, single-consumer ring.
//!
//! Hands values from a host's audio thread to the control thread.
//! [`Producer::push`] never allocates, locks or blocks: when the ring is
//! full it drops the value and counts it, so the audio thread never waits on
//! a slow consumer.

use std::cell::UnsafeCell;
use std::mem::MaybeUninit;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

struct Shared<T> {
    slots: Box<[UnsafeCell<MaybeUninit<T>>]>,
    /// Values pushed so far; only the producer stores it.
    head: AtomicUsize,
    /// Values popped so far; only the consumer stores it.
    tail: AtomicUsize,
    /// Values dropped because the ring was full.
    dropped: AtomicU64,
}

// SAFETY: a slot is written only by the single producer while it is outside
// `tail..head`, and read only by the single consumer while it is inside;
// the release/acquire pairs on `head` and `tail` hand each slot over.
unsafe impl<T: Send> Sync for Shared<T> {}

impl<T> Shared<T> {
    fn slot(&self, index: usize) -> *mut MaybeUninit<T> {
        self.slots[index % self.slots.len()].get()
    }
}

/// Writing end of a [`ring`]; owned by the audio thread.
pub struct Producer<T> {
    shared: Arc<Shared<T>>,
}

/// Reading end of a [`ring`]; owned by the control thread.
pub struct Consumer<T> {
    shared: Arc<Shared<T>>,
}

/// Creates a ring holding up to `capacity` values. Allocates only here.
pub fn ring<T: Copy + Send>(capacity: usize) -> (Producer<T>, Consumer<T>) {
    assert!(capacity > 0, "ring capacity must be positive");
    let shared = Arc::new(Shared {
        slots: (0..capacity)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect(),
        head: AtomicUsize::new(0),
        tail: AtomicUsize::new(0),
        dropped: AtomicU64::new(0),
    });
    (
        Producer {
            shared: Arc::clone(&shared),
        },
        Consumer { shared },
    )
}

impl<T: Copy> Producer<T> {
    /// Appends `value`, or drops it and returns false when the ring is full.
    pub fn push(&mut self, value: T) -> bool {
        let shared = &*self.shared;
        let head = shared.head.load(Ordering::Relaxed);
        let tail = shared.tail.load(Ordering::Acquire);
        if head.wrapping_sub(tail) == shared.slots.len() {
            shared.dropped.fetch_add(1, Ordering::Relaxed);
            return false;
        }
        // SAFETY: the slot at `head` is outside `tail..head`, so the
        // consumer is not reading it, and `&mut self` excludes other writers.
        unsafe { (*shared.slot(head)).write(value) };
        shared.head.store(head.wrapping_add(1), Ordering::Release);
        true
    }
}

impl<T: Copy> Consumer<T> {
    /// Removes the oldest value, if any.
    pub fn pop(&mut self) -> Option<T> {
        let shared = &*self.shared;
        let tail = shared.tail.load(Ordering::Relaxed);
        let head = shared.head.load(Ordering::Acquire);
        if head == tail {
            return None;
        }
        // SAFETY: the slot at `tail` is inside `tail..head`, so the producer
        // finished writing it before publishing `head`.
        let value = unsafe { (*shared.slot(tail)).assume_init_read() };
        shared.tail.store(tail.wrapping_add(1), Ordering::Release);
        Some(value)
    }

    /// Pops every value currently queued.
    pub fn drain(&mut self) -> impl Iterator<Item = T> + '_ {
        std::iter::from_fn(|| self.pop())
    }

    /// Values the producer dropped because the ring was full.
    pub fn dropped(&self) -> u64 {
        self.shared.dropped.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pops_in_push_order_and_drops_when_full() {
        let (mut producer, mut consumer) = ring(3);
        assert_eq!(consumer.pop(), None);
        assert!(producer.push(1));
        assert!(producer.push(2));
        assert!(producer.push(3));
        assert!(!producer.push(4));
        assert_eq!(consumer.dropped(), 1);
        assert_eq!(consumer.pop(), Some(1));
        assert!(producer.push(5));
        assert_eq!(consumer.drain().collect::<Vec<_>>(), [2, 3, 5]);
        assert_eq!(consumer.pop(), None);
    }

    #[test]
    fn hands_values_across_threads_in_order() {
        const COUNT: u32 = 100_000;
        let (mut producer, mut consumer) = ring(64);
        let writer = std::thread::spawn(move || {
            for value in 0..COUNT {
                while !producer.push(value) {
                    std::thread::yield_now();
                }
            }
        });
        let mut expected = 0;
        while expected < COUNT {
            match consumer.pop() {
                Some(value) => {
                    assert_eq!(value, expected);
                    expected += 1;
                }
                None => std::thread::yield_now(),
            }
        }
        writer.join().unwrap();
        assert_eq!(consumer.pop(), None);
    }
}
