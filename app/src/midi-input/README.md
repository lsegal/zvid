# MIDI device mappings

`midi-devices.json` maps 200 MIDI devices (#1554), as data: the port names
that recognize each and the message each of its keys and controls sends. See
`MidiDeviceMapping` in `device-mappings.ts` for the format, and
`device-mappings.test.ts` for what's validated. Keys and pads act on the piano
roll, and knobs and faders on effects and volumes (see below); the rest exist so
that their messages are recognized and ignored. A device that isn't listed plays
through the standard keyboard layout.

## What the controls do

A listed device needs no mapping by hand (#1615). `device-controls.ts` gives its
continuous controls roles from their kinds and names, so that every device follows
the same rules:

- Knobs and encoders, in the order the device lists them, drive the selected
  effect's numeric parameters 1 to N, in panel order. Extra knobs do nothing, and
  neither do any while no effect is selected.
- A control named for volume or master, a lone fader, or the ninth of nine moves
  the app's volume (the transport bar's).
- Other numbered faders move the source tracks' volumes in track order: the first
  Gain in the track's own stack, added if it has none.

Encoders are read as absolute unless their entry says `relative`, which only the
Push family's does so far: its Ableton-documented encoders send steps, not places.
A mapping made by hand always wins. Notes take no role here, and a CC mapped to a
knob or fader in MIDI Map mode stops doing what its role did. Mapped by hand, a CC
works on any device, listed or not, and is read as absolute unless its device's
entry says `relative`. Faders that send pitch bend can't be mapped by hand.

## How far to trust the data

Nothing here was checked against hardware. Each device records where its
mapping came from in `source`. #1559 checked every estimated entry against
published charts and manuals, and a device is `documented`
only where a document gives their numbers:

- `verification: "documented"`: the note and CC numbers were read from the
  source. `source.note`, when present, says which parts weren't, and when the
  source is a third party's map or a retailer's copy of the manual.
- `verification: "inventory"`: no chart was found. `source.note` always says
  so, and names what the search turned up and any control left out for want of
  a message. The numbers it doesn't vouch for are estimates from convention
  (keys on channel 1 from the factory octave, mod wheel CC 1, sustain CC 64,
  pads on channel 10 from note 36).

Manuals often leave the keys' starting note unstated, because the octave
buttons move it, so most keyboards stay `inventory` even when their other
controls were read.

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

A key from a device playing MPE auditions until it comes up. A device with no
configuration message isn't known to play MPE until its second member channel,
so its first key after connecting starts on the fixed audition, and holds from
then on if it is still down and that audition hasn't ended.
