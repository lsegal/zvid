# MIDI device mappings

`midi-devices.json` maps 200 MIDI devices (#1554), as data: the port names
that recognize each and the message each of its keys and controls sends. See
`MidiDeviceMapping` in `device-mappings.ts` for the format, and
`device-mappings.test.ts` for what's validated. Only keys and pads act on the
piano roll today; the rest exist so that their messages are recognized and
ignored. A device that isn't listed plays through the standard keyboard layout.

## How far to trust the data

Nothing here was checked against hardware. Each device records where its
mapping came from in `source`:

- `verification: "documented"`: the note and CC numbers were read from the
  source. `source.note`, when present, says which parts weren't.
- `verification: "inventory"`: the source confirms which controls the device
  has, but not what they send. Those numbers are estimates from convention
  (keys on channel 1 from the factory octave, mod wheel CC 1, sustain CC 64,
  pads on channel 10 from note 36), and control counts may be estimates too.
  `source.note` says when a source is weak or a control is missing.

Port names are likewise the best known, not observed from each device. When a
mapping is wrong the cost is small: a misnamed port falls back to the standard
layout, and only a note wrongly mapped to a non-key control stops playing.

Replace an `inventory` entry whenever a MIDI chart for the device turns up.
Controls that send no MIDI (octave shift, shift, power) aren't listed. Where a
device's controls share messages across banks or layers, the default one is.

## Choosing the 200

No authoritative popularity ranking exists. The list was chosen by hand from
what these public sources show selling and recommended, filled out with each
popular maker's current and recent ranges, and capped at 200:

- [Reverb: best-selling keyboard MIDI controllers](https://reverb.com/top/keyboards-and-synths/keyboard-midi-controllers)
- [Sweetwater: MIDI keyboard controllers](https://www.sweetwater.com/c513--MIDI_Keyboards_Controllers)
- [Bax Music: top 10 best-selling MIDI keyboards](https://bax-shop.co.uk/top-10/midi-keyboard)
- [Galaxus: MIDI controllers top list](https://www.galaxus.de/en/s1/producttype/toplist/relevance/midi-controllers-520)
- [Midination: the best MIDI keyboards](https://midination.com/?p=30)
- [Hip Hop Makers: best MIDI keyboards](https://hiphopmakers.com/best-midi-controller-keyboards)

## MPE

MPE devices need no mapping: `mpe.ts` reads each input's zones and per-note
expression whatever the device. A device that hasn't sent an MPE Configuration
Message counts as MPE once it plays on two member channels of the
specification's default zone, so ordinary keyboards stay as they are.
