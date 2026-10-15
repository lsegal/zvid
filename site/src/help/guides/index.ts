import { ableton } from "./ableton";
import { audio } from "./audio";
import { collaboration } from "./collaboration";
import { editing } from "./editing";
import { exportGuide } from "./export";
import { motion } from "./motion";
import { recording } from "./recording";
import type { Guide } from "./types";
import { video } from "./video";

// The guides in reading order; the overview's topics link to each by id.
export const guides: Guide[] = [
  ableton,
  recording,
  video,
  motion,
  editing,
  audio,
  collaboration,
  exportGuide,
];
