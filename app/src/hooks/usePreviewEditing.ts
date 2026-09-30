import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { isClipAtPlayhead } from "../app/timeline-math.ts";
import type { ArrangementClip, Lane } from "../app/types.ts";
import type {
  PreviewLayerMove,
  PreviewLayerTransformEdit,
  PreviewTextEdit,
} from "../components/PreviewTransformOverlay";
import { clipEffectTrackId, type SessionEffect } from "../fx-stack";
import {
  getPreviewEditTrackId,
  moveHistoryLabel,
  type PreviewEditTarget,
  type PreviewLayer,
  readLayerTransform,
  readLayerTransformPosition,
  setLayerTransformParameters,
  setLayerTransformPosition,
} from "../preview-edit.ts";
import {
  MOVE_ORIGIN_HISTORY_LABEL,
  resizeHistoryLabel,
} from "../preview-resize.ts";
import { rotateHistoryLabel } from "../preview-rotate.ts";
import {
  setClipText,
  stepClipFontSize,
  TEXT_EDIT_HISTORY_LABEL,
  type TextEditorKeyAction,
  toggleClipTextStyle,
} from "../preview-text-edit.ts";
import { isTextClip } from "../text-clip.ts";
import { resolveTextStyle } from "../text-style.ts";

export type PreviewEditingInputs = {
  bpm: number;
  editEffects: (
    label: string,
    updater: (effects: SessionEffect[]) => SessionEffect[],
    mode?: "commit" | "transient",
  ) => void;
  effects: SessionEffect[];
  isExporting: boolean;
  isPlaying: boolean;
  lanes: Lane[];
  playbackOriginRef: RefObject<number>;
  playheadQRef: RefObject<number>;
  previewLayers: PreviewLayer[];
  refuseReadOnlyEdit: () => boolean;
  selectedClipId: string | undefined;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setPlayheadQ: (nextQ: number) => void;
  setPreviewLaneId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedClipId: Dispatch<SetStateAction<string | undefined>>;
  setSelectedLaneId: Dispatch<SetStateAction<string | undefined>>;
  timelineClipsRef: RefObject<ArrangementClip[]>;
};

// Selecting, moving and transforming preview layers, and editing a text clip's
// text in place in the preview.
export function usePreviewEditing({
  bpm,
  editEffects,
  effects,
  isExporting,
  isPlaying,
  lanes,
  playbackOriginRef,
  playheadQRef,
  previewLayers,
  refuseReadOnlyEdit,
  selectedClipId,
  setIsPlaying,
  setPlayheadQ,
  setPreviewLaneId,
  setSelectedClipId,
  setSelectedLaneId,
  timelineClipsRef,
}: PreviewEditingInputs) {
  const effectsRef = useRef(effects);
  effectsRef.current = effects;
  const selectPreviewLayer = useCallback(
    (layer: PreviewLayer | undefined) => {
      setPreviewLaneId(layer?.laneId);
      if (layer) {
        setSelectedClipId(layer.clipId);
        setSelectedLaneId(layer.laneId);
      } else {
        setSelectedClipId(undefined);
      }
    },
    [setPreviewLaneId, setSelectedClipId, setSelectedLaneId],
  );
  // A preview edit goes to the selected clip's own Transform, or to the
  // layer's when only the layer is selected; its history names either.
  const describePreviewEditTarget = useCallback(
    ({ laneId, clipId }: PreviewEditTarget) =>
      (clipId !== undefined
        ? timelineClipsRef.current.find((clip) => clip.id === clipId)?.label
        : undefined) ??
      lanes.find((lane) => lane.id === laneId)?.name ??
      `Layer ${laneId}`,
    [lanes, timelineClipsRef],
  );
  const getPreviewLayerPosition = useCallback(
    (target: PreviewEditTarget) =>
      readLayerTransformPosition(
        effectsRef.current,
        getPreviewEditTrackId(target),
      ),
    [],
  );
  const movePreviewLayer = useCallback(
    ({ position, mode, newEffectId, ...target }: PreviewLayerMove) =>
      editEffects(
        moveHistoryLabel(describePreviewEditTarget(target)),
        (current) =>
          setLayerTransformPosition(
            current,
            getPreviewEditTrackId(target),
            position,
            newEffectId,
          ),
        mode,
      ),
    [describePreviewEditTarget, editEffects],
  );
  const getPreviewLayerTransform = useCallback(
    (target: PreviewEditTarget) =>
      readLayerTransform(effectsRef.current, getPreviewEditTrackId(target)),
    [],
  );
  const transformPreviewLayer = useCallback(
    ({
      kind,
      values,
      mode,
      newEffectId,
      ...target
    }: PreviewLayerTransformEdit) => {
      const targetName = describePreviewEditTarget(target);
      editEffects(
        kind === "resize"
          ? resizeHistoryLabel(targetName)
          : kind === "rotate"
            ? rotateHistoryLabel(targetName)
            : MOVE_ORIGIN_HISTORY_LABEL,
        (current) =>
          setLayerTransformParameters(
            current,
            getPreviewEditTrackId(target),
            values,
            newEffectId,
          ),
        mode,
      );
    },
    [describePreviewEditTarget, editEffects],
  );
  // The text clip being typed on in the preview. Every keystroke is a
  // transient edit of the clip's Text effect, so the FX panel and
  // collaborators follow along, and leaving the editor commits the whole
  // edit as one undo step.
  const [textEdit, setTextEdit] = useState<{
    clipId: string;
    laneId: string;
    // Id for the Text effect an edit adds when the layer has none.
    newEffectId: string;
  }>();
  const textEditRef = useRef(textEdit);
  textEditRef.current = textEdit;
  const finishTextEdit = useCallback(() => {
    if (!textEditRef.current) {
      return;
    }

    textEditRef.current = undefined;
    setTextEdit(undefined);
    editEffects(TEXT_EDIT_HISTORY_LABEL, (current) => current);
  }, [editEffects]);
  const startTextEdit = useCallback(
    (clipId: string) => {
      const clip = timelineClipsRef.current.find(
        (candidate) => candidate.id === clipId,
      );
      if (
        !clip ||
        !isTextClip(clip) ||
        textEditRef.current?.clipId === clipId ||
        isExporting ||
        refuseReadOnlyEdit()
      ) {
        return;
      }

      finishTextEdit();
      // Playback pauses while editing, with the clip under the playhead.
      setIsPlaying(false);
      if (!isClipAtPlayhead(clip, playheadQRef.current, bpm)) {
        setPlayheadQ(clip.startQ);
        playbackOriginRef.current = clip.startQ;
      }
      setSelectedClipId(clip.id);
      setSelectedLaneId(clip.laneId);
      setPreviewLaneId(clip.laneId);
      const next = {
        clipId: clip.id,
        laneId: clip.laneId,
        newEffectId: crypto.randomUUID(),
      };
      textEditRef.current = next;
      setTextEdit(next);
    },
    [
      bpm,
      finishTextEdit,
      isExporting,
      playbackOriginRef,
      playheadQRef,
      refuseReadOnlyEdit,
      setIsPlaying,
      setPlayheadQ,
      setPreviewLaneId,
      setSelectedClipId,
      setSelectedLaneId,
      timelineClipsRef,
    ],
  );
  const activatePreviewLayer = useCallback(
    (layer: PreviewLayer) => startTextEdit(layer.clipId),
    [startTextEdit],
  );
  const changeEditedText = useCallback(
    (text: string) => {
      const edit = textEditRef.current;
      if (edit) {
        editEffects(
          TEXT_EDIT_HISTORY_LABEL,
          (current) =>
            setClipText(current, edit.clipId, text, edit.newEffectId),
          "transient",
        );
      }
    },
    [editEffects],
  );
  const applyTextEditAction = useCallback(
    (action: TextEditorKeyAction) => {
      const edit = textEditRef.current;
      if (!edit) {
        return;
      }

      if (action.kind === "commit") {
        finishTextEdit();
        return;
      }

      // Style shortcuts restyle the whole clip, within the same undo step.
      editEffects(
        TEXT_EDIT_HISTORY_LABEL,
        (current) =>
          action.kind === "style"
            ? toggleClipTextStyle(
                current,
                edit.clipId,
                action.flag,
                edit.newEffectId,
              )
            : stepClipFontSize(
                current,
                edit.clipId,
                action.direction,
                edit.newEffectId,
              ),
        "transient",
      );
    },
    [editEffects, finishTextEdit],
  );
  const editedTextStyle = useMemo(
    () =>
      textEdit
        ? resolveTextStyle(
            effects,
            textEdit.laneId,
            clipEffectTrackId(textEdit.clipId),
          )
        : undefined,
    [effects, textEdit],
  );
  const previewTextEdit = useMemo<PreviewTextEdit | undefined>(
    () =>
      textEdit && editedTextStyle
        ? {
            clipId: textEdit.clipId,
            style: editedTextStyle,
            onChangeText: changeEditedText,
            onAction: applyTextEditAction,
          }
        : undefined,
    [applyTextEditAction, changeEditedText, editedTextStyle, textEdit],
  );
  // Starting playback, selecting another layer or clip, or the clip leaving
  // the preview (deleted, or the playhead moved off it) finishes editing.
  useEffect(() => {
    if (
      textEdit &&
      (isPlaying ||
        selectedClipId !== textEdit.clipId ||
        !previewLayers.some((layer) => layer.clipId === textEdit.clipId))
    ) {
      finishTextEdit();
    }
  }, [finishTextEdit, isPlaying, previewLayers, selectedClipId, textEdit]);

  return {
    selectPreviewLayer,
    getPreviewLayerPosition,
    movePreviewLayer,
    getPreviewLayerTransform,
    transformPreviewLayer,
    textEdit,
    finishTextEdit,
    startTextEdit,
    activatePreviewLayer,
    previewTextEdit,
  };
}
