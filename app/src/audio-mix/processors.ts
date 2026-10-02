// The audio effect processors registered from the effect folders (see
// fx/effects/processors.generated.ts), by effect name.
import { EFFECT_AUDIO_PROCESSORS } from "../fx/effects/processors.generated.ts";
import { createProcessorRegistry } from "./processor.ts";

export const AUDIO_PROCESSORS = createProcessorRegistry(
  EFFECT_AUDIO_PROCESSORS,
);
