// Reverse plays a clip's source window backwards: the clip's timeline start
// plays the window's end and its end plays the window's start. It changes
// where the clip reads its media rather than processing its sound, so it is
// a source stage (see AudioSourceStage); warp markers then map the mirrored
// position, so the reversed timing mirrors the forward timing.

export const REVERSE_EFFECT_NAME = "Reverse";

// The timeline second whose media a reversed clip playing from
// `startSeconds` to `endSeconds` plays at timeline second `seconds`.
export function reverseReadSeconds(
  seconds: number,
  span: { startSeconds: number; endSeconds: number },
) {
  return span.startSeconds + span.endSeconds - seconds;
}
