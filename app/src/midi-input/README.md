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

An encoder whose entry says `relative` is read as steps from its first message,
in the format named: `twos-complement` (1 is one step up, 127 one step down) or
`sign-magnitude` (65 is one step down). Any other CC, on any device, is told
apart by what it sends (`relative-cc.ts`, #1644): the same small step twice
running, or a step up next to a step down, is an encoder, read in whichever of
the two formats its values fall in, and a mid-range value, 0, or a run of values
with neither is a knob or fader's position. A control's first messages are held,
moving nothing, until one or the other shows.

A mapping made by hand always wins. Notes take no role here, and a CC mapped to a
knob or fader in MIDI Map mode stops doing what its role did. Mapped by hand, a CC
works on any device, listed or not, and its encoders step as above. Faders that send pitch bend can't be mapped by hand.

A control that sends 14-bit CC, an MSB on controller N and an LSB on N + 32 for
each move, maps by hand as one control on N and moves at full resolution
(`cc14.ts`). It's recognized by the LSB arriving straight after its MSB, so
controllers 32 to 63 stay separate controls on devices that use them that way.
Built-in roles still read these controls as 7-bit.

## Which encoders were checked

#1630 read the published chart of every device with an encoder, or a knob on one,
for what it sends at factory defaults. None was tried on hardware.

Relative:

| Device | Encoders | Format | From |
| --- | --- | --- | --- |
| Behringer X-Touch, X-Touch One | Encoders, jog wheel | Sign and magnitude | A third party's Mackie Control map, for their factory mode |
| PreSonus FaderPort (2018) | Session Navigator | Sign and magnitude | Its manual |
| Ableton Push 2 | All | Two's complement | Ableton's MIDI interface document |
| Ableton Push 1, Push 3 | All | Two's complement | Assumed from Push 2: no chart |
| Akai Fire | All | Two's complement | SEGGER's decoding of the device |
| Akai APC40, APC40 mkII | Cue level, and the mkII's tempo knob | Two's complement | Akai's protocol |
| Akai APC Key 25 mkII | Knobs | Two's complement, assumed from the APC40 | Akai's protocol says only relative |
| Keith McMillen QuNeo | Rotary direction | Two's complement | Its manual |

Read as positions, an encoder's 1 and 127 slam its target between the ends of
its range (#1644), which is why unlisted controls are told apart by what they
send. A Push's built-in roles only work on a port recognized as a Push. Its ports go by different names by
platform, which Ableton gives as `Ableton Push (Port 2)` on Windows and
`Ableton Push (User Port)` on macOS, with no generation, so a bare `Ableton Push`
is read as the 1st generation, whose encoders send the same messages.

Absolute, or relative only when set so, in the charts or manuals that cover them:
Behringer BCR2000 and BCF2000; Arturia MiniLab and MiniLab mkII,
BeatStep, BeatStep Pro, KeyLab Essential and KeyLab; Nektar Panorama T4 and T6;
Novation Launchkey MK4; M-Audio Oxygen Pro and Hammer 88 Pro; Korg
nanoKONTROL Studio.

Not stated anywhere found, so read as absolute: Behringer X-Touch Mini, whose chart
gives only its numbers; Arturia MiniLab 3 and KeyStep Pro; Native Instruments
Maschine and Komplete Kontrol; and Novation SL MkIII, whose chart covers only its
InControl mode, where the knobs send two's complement on channel 16.

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
