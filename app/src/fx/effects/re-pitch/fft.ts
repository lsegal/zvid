// An in-place radix-2 FFT of one fixed size whose bit-reversal and twiddle
// tables are worked out once, so transforming allocates nothing and can run
// in the audio thread.
export class Fft {
  readonly size: number;
  private readonly reversed: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;

  // `size` must be a power of two.
  constructor(size: number) {
    this.size = size;
    this.reversed = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let index = 0; index < size; index++) {
      let reversed = 0;
      for (let bit = 0; bit < bits; bit++) {
        reversed = (reversed << 1) | ((index >> bit) & 1);
      }
      this.reversed[index] = reversed;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let index = 0; index < size / 2; index++) {
      this.cos[index] = Math.cos((2 * Math.PI * index) / size);
      this.sin[index] = -Math.sin((2 * Math.PI * index) / size);
    }
  }

  // The forward transform of `real` + i·`imaginary`, in place.
  forward(real: Float64Array, imaginary: Float64Array) {
    this.transform(real, imaginary, 1);
  }

  // The inverse transform, scaled by 1 / size, in place.
  inverse(real: Float64Array, imaginary: Float64Array) {
    this.transform(real, imaginary, -1);
    const scale = 1 / this.size;
    for (let index = 0; index < this.size; index++) {
      real[index] *= scale;
      imaginary[index] *= scale;
    }
  }

  private transform(
    real: Float64Array,
    imaginary: Float64Array,
    direction: 1 | -1,
  ) {
    const { size, reversed, cos, sin } = this;
    for (let index = 0; index < size; index++) {
      const swap = reversed[index];
      if (index < swap) {
        const swappedReal = real[index];
        real[index] = real[swap];
        real[swap] = swappedReal;
        const swappedImaginary = imaginary[index];
        imaginary[index] = imaginary[swap];
        imaginary[swap] = swappedImaginary;
      }
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1;
      const stride = size / length;
      for (let offset = 0; offset < size; offset += length) {
        for (let index = 0; index < half; index++) {
          const twiddleReal = cos[index * stride];
          const twiddleImaginary = direction * sin[index * stride];
          const even = offset + index;
          const odd = even + half;
          const oddReal =
            real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const oddImaginary =
            real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          real[odd] = real[even] - oddReal;
          imaginary[odd] = imaginary[even] - oddImaginary;
          real[even] += oddReal;
          imaginary[even] += oddImaginary;
        }
      }
    }
  }
}
