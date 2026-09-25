//! A value the control thread replaces and the audio thread reads without
//! locking.
//!
//! Readers get a plain reference to the current value. Replaced values are
//! kept until the [`Swap`] is dropped, so a reference a reader still holds
//! never dangles. That trades a little memory per store for wait-free reads,
//! which suits settings a host changes a handful of times per session.

use std::ptr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicPtr, Ordering};

pub struct Swap<T> {
    current: AtomicPtr<T>,
    /// Replaced values, kept alive for readers. Its lock also serializes
    /// writers.
    retired: Mutex<Vec<Box<T>>>,
}

// SAFETY: readers on any thread get `&T` (needs `T: Sync`), and values are
// dropped on whichever thread drops the `Swap` (needs `T: Send`).
unsafe impl<T: Send + Sync> Sync for Swap<T> {}
unsafe impl<T: Send> Send for Swap<T> {}

impl<T> Swap<T> {
    pub fn new(value: T) -> Self {
        Self {
            current: AtomicPtr::new(Box::into_raw(Box::new(value))),
            retired: Mutex::new(Vec::new()),
        }
    }

    /// The current value. Wait-free.
    pub fn load(&self) -> &T {
        // SAFETY: `current` always points at a live box, and boxes are only
        // freed when `self` is dropped.
        unsafe { &*self.current.load(Ordering::Acquire) }
    }

    /// Replaces the value. May block on other writers, never on readers.
    pub fn store(&self, value: T) {
        self.update(|_| value);
    }

    /// Replaces the value with one computed from the current value, without
    /// losing a concurrent writer's update.
    pub fn update(&self, change: impl FnOnce(&T) -> T) {
        let mut retired = self
            .retired
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let new = Box::into_raw(Box::new(change(self.load())));
        let old = self.current.swap(new, Ordering::AcqRel);
        // SAFETY: `old` came from `Box::into_raw` and is no longer current.
        retired.push(unsafe { Box::from_raw(old) });
    }
}

impl<T> Drop for Swap<T> {
    fn drop(&mut self) {
        let current = std::mem::replace(self.current.get_mut(), ptr::null_mut());
        // SAFETY: `current` came from `Box::into_raw`, and `&mut self` means
        // no reader holds it.
        drop(unsafe { Box::from_raw(current) });
    }
}

impl<T: Default> Default for Swap<T> {
    fn default() -> Self {
        Self::new(T::default())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    #[test]
    fn readers_keep_old_values_valid() {
        let swap = Swap::new(String::from("first"));
        let old = swap.load();
        swap.store(String::from("second"));
        assert_eq!(old, "first");
        assert_eq!(swap.load(), "second");
    }

    #[test]
    fn update_sees_the_current_value() {
        let swap = Swap::new(vec![1]);
        swap.update(|list| [list.as_slice(), &[2]].concat());
        swap.update(|list| [list.as_slice(), &[3]].concat());
        assert_eq!(swap.load(), &[1, 2, 3]);
    }

    #[test]
    fn concurrent_updates_are_not_lost() {
        let swap = Arc::new(Swap::new(0u32));
        let writers: Vec<_> = (0..4)
            .map(|_| {
                let swap = Arc::clone(&swap);
                std::thread::spawn(move || {
                    for _ in 0..250 {
                        swap.update(|value| value + 1);
                    }
                })
            })
            .collect();
        for writer in writers {
            writer.join().unwrap();
        }
        assert_eq!(*swap.load(), 1000);
    }

    #[test]
    fn drops_every_value() {
        let marker = Arc::new(());
        {
            let swap = Swap::new(Arc::clone(&marker));
            swap.store(Arc::clone(&marker));
            swap.store(Arc::clone(&marker));
            assert_eq!(Arc::strong_count(&marker), 4);
        }
        assert_eq!(Arc::strong_count(&marker), 1);
    }
}
