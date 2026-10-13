// Listing the effects there are, and adding, configuring, reordering and
// removing them on stacks.
import { patchProjectState } from "../../app/session-project.ts";
import type { ProjectState } from "../../app/types.ts";
import { isShapeEffectName } from "../../fx/effects/shape/shape.ts";
import { findParameterDefinition } from "../../fx/stack/ops.ts";
import { isFxClip } from "../../fx-clip.ts";
import {
  FX_EFFECT_DEFINITIONS,
  type FxEffectDefinition,
  type FxEffectScope,
  type FxParameterDefinition,
  getEffectDefinition,
  getEffectDomain,
  isDisplayParameter,
  isEffectSupportedIn,
} from "../../fx-registry.ts";
import {
  addEffect,
  getEffectClipId,
  getTrackGroup,
  moveEffect,
  removeEffect,
  type SessionEffect,
  setEffectEnabled,
  setEffectParameter,
} from "../../fx-stack.ts";
import { addShapeTransform } from "../../preview-edit.ts";
import {
  describeEffect,
  findEffect,
  optionalBoolean,
  optionalNumber,
  optionalString,
  requireString,
  resolveStack,
  STACK_TARGETS,
  type StackTarget,
} from "../helpers.ts";
import { objectSchema } from "../schema.ts";
import { type ControlCommand, ControlFailure } from "../types.ts";

const EFFECT_ID = { type: "string", description: "The effect's id." } as const;

function isEditable(parameter: FxParameterDefinition) {
  return !parameter.hidden && !isDisplayParameter(parameter);
}

function describeParameter(parameter: FxParameterDefinition) {
  const base = {
    key: parameter.key,
    label: parameter.label,
    kind: parameter.kind,
    default: parameter.defaultValue,
  };
  switch (parameter.kind) {
    case "number":
      return {
        ...base,
        min: parameter.min,
        max: parameter.max,
        ...(parameter.step !== undefined ? { step: parameter.step } : {}),
        ...(parameter.control === "toggle" ? { toggle: true } : {}),
      };
    case "enum":
      return { ...base, options: parameter.options };
    case "flags":
      return {
        ...base,
        options: parameter.options.map((option) => option.value),
      };
    default:
      return base;
  }
}

// Every layer already has its own Layout, so list_effects and add_effect
// offer it only for the other stacks it supports.
function addableScopes(definition: FxEffectDefinition) {
  return definition.layerDefault
    ? definition.scopes.filter((scope) => scope !== "layer")
    : definition.scopes;
}

function describeDefinition(definition: FxEffectDefinition) {
  return {
    effectName: definition.effectName,
    displayName: definition.displayName,
    description: definition.description,
    domain: getEffectDomain(definition),
    category: definition.category,
    scopes: addableScopes(definition),
    parameters: definition.parameters.filter(isEditable).map(describeParameter),
  };
}

// The stack scope `trackId` adds effects with: an FX clip's own stack takes
// the effects that work on a composite.
function stackScope(project: ProjectState, trackId: string): FxEffectScope {
  const clipId = getEffectClipId(trackId);
  return clipId !== undefined &&
    isFxClip(project.clips.find((clip) => clip.id === clipId))
    ? "fxClip"
    : getTrackGroup(trackId);
}

// `value` checked against the parameter `key` of `effect`, as stored.
function checkParameterValue(
  project: ProjectState,
  effect: SessionEffect,
  key: string,
  value: number | string,
): number | string {
  const definition = getEffectDefinition(effect.effectName);
  // An effect the registry doesn't know keeps whatever it is given.
  if (!definition.known) {
    return value;
  }
  const parameter = findParameterDefinition(definition, key);
  if (!parameter || !isEditable(parameter)) {
    throw new ControlFailure(
      "not_found",
      `${definition.displayName} has no parameter "${key}". Its parameters: ${definition.parameters
        .filter(isEditable)
        .map((item) => `"${item.key}"`)
        .join(", ")}.`,
    );
  }
  const invalid = (message: string) =>
    new ControlFailure("invalid_input", `${parameter.label}: ${message}`);
  switch (parameter.kind) {
    case "number":
      if (typeof value !== "number") {
        throw invalid(
          `must be a number from ${parameter.min} to ${parameter.max}.`,
        );
      }
      if (value < parameter.min || value > parameter.max) {
        throw invalid(`${value} is outside ${parameter.min}–${parameter.max}.`);
      }
      return value;
    case "enum": {
      const option = parameter.options.find(
        (candidate) => candidate.toLowerCase() === `${value}`.toLowerCase(),
      );
      if (option === undefined) {
        throw invalid(
          `must be one of ${parameter.options.map((item) => `"${item}"`).join(", ")}.`,
        );
      }
      return option;
    }
    case "flags": {
      const allowed = parameter.options.map((option) => option.value);
      const values = `${value}`
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      const unknown = values.filter((item) => !allowed.includes(item));
      if (unknown.length) {
        throw invalid(
          `takes a comma-separated list of ${allowed.map((item) => `"${item}"`).join(", ")}.`,
        );
      }
      return values.join(",");
    }
    case "layers":
    case "layer": {
      const ids = `${value}`
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      if (parameter.kind === "layer" && ids.length > 1) {
        throw invalid("takes a single layer id, or an empty string for none.");
      }
      const missing = ids.filter(
        (id) => !project.lanes.some((lane) => lane.id === id),
      );
      if (missing.length) {
        throw invalid(
          `no layer has id ${missing.map((id) => `"${id}"`).join(", ")}.`,
        );
      }
      return ids.join(",");
    }
    default:
      if (typeof value !== "string") {
        throw invalid("must be a string.");
      }
      return value;
  }
}

export const effectCommands: ControlCommand[] = [
  {
    name: "list_effects",
    description:
      "Lists the effects add_effect can add: their names, what they do, whether they process video or audio, which stacks take them (scopes: layer, clip, global, fxClip) and their parameters with ranges, options and defaults.",
    inputSchema: objectSchema({
      domain: {
        type: "string",
        description: "Only video or only audio effects.",
        enum: ["video", "audio"],
      },
    }),
    run(_host, input) {
      const domain = optionalString(input, "domain");
      return FX_EFFECT_DEFINITIONS.filter(
        (definition) =>
          addableScopes(definition).length > 0 &&
          (!domain || getEffectDomain(definition) === domain),
      ).map(describeDefinition);
    },
  },
  {
    name: "add_effect",
    description:
      "Adds an effect with its default parameters to a stack: a layer's, a clip's own, the Global stack that processes the whole picture, a source track's or a source clip's. Stacks run top to bottom. Returns the effect; configure it with set_effect_parameter. Effect names come from list_effects (such as \"Reverb\" or \"GaussianBlur\").",
    inputSchema: objectSchema(
      {
        effectName: {
          type: "string",
          description: "The effect's effectName from list_effects.",
        },
        target: {
          type: "string",
          description: "Which kind of stack to add it to.",
          enum: STACK_TARGETS,
        },
        targetId: {
          type: "string",
          description:
            "The layer, clip, source track or source clip id; omit for global.",
        },
        index: {
          type: "integer",
          description:
            "Its position in the stack, 0 for first; last when omitted.",
          minimum: 0,
        },
      },
      ["effectName", "target"],
    ),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const effectName = requireString(input, "effectName");
      const definition = FX_EFFECT_DEFINITIONS.find(
        (candidate) =>
          candidate.effectName.toLowerCase() === effectName.toLowerCase() ||
          candidate.displayName.toLowerCase() === effectName.toLowerCase(),
      );
      if (!definition) {
        throw new ControlFailure(
          "not_found",
          `There is no "${effectName}" effect. Call list_effects for their names.`,
        );
      }
      const target = requireString(input, "target") as StackTarget;
      const trackId = resolveStack(
        project,
        target,
        optionalString(input, "targetId"),
      );
      const scope = stackScope(project, trackId);
      if (
        !isEffectSupportedIn(definition.effectName, scope) ||
        !addableScopes(definition).includes(scope)
      ) {
        throw new ControlFailure(
          "unavailable",
          `${definition.displayName} can't go on a ${scope === "fxClip" ? "FX clip's" : scope} stack; it works on ${addableScopes(definition).join(", ")} stacks.`,
        );
      }
      const id = crypto.randomUUID();
      const transformId = crypto.randomUUID();
      const index = optionalNumber(input, "index");
      const add = (effects: SessionEffect[]) =>
        addEffect(effects, trackId, definition.effectName, index, id, scope);
      if (add(project.effects) === project.effects) {
        throw new ControlFailure(
          "unavailable",
          `${definition.displayName} can't be added there; a stack takes one Layout and the Global stack none.`,
        );
      }
      host.commit(`Add ${definition.displayName}`, (current) => {
        const effects = add(current.effects);
        // A Shape on a layer without a Transform starts as a centered
        // square, as the FX panel adds it.
        return patchProjectState(current, {
          effects:
            effects !== current.effects &&
            isShapeEffectName(definition.effectName)
              ? addShapeTransform(
                  effects,
                  trackId,
                  { width: current.canvasWidth, height: current.canvasHeight },
                  transformId,
                )
              : effects,
        });
      });
      const latest = host.getProject();
      return describeEffect(findEffect(latest, id), latest);
    },
  },
  {
    name: "set_effect_parameter",
    description:
      "Sets one parameter of an effect. Numbers must be within the parameter's range; enum values must be one of its options; colors are CSS colors; layer parameters take layer ids (comma-separated for several). Parameter keys and ranges come from list_effects; current values from get_session.",
    inputSchema: objectSchema(
      {
        effectId: EFFECT_ID,
        key: { type: "string", description: "The parameter's key." },
        value: {
          type: ["number", "string"],
          description: "The new value.",
        },
      },
      ["effectId", "key", "value"],
    ),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const effect = findEffect(project, requireString(input, "effectId"));
      const key = requireString(input, "key");
      const value = checkParameterValue(
        project,
        effect,
        key,
        input.value as number | string,
      );
      host.commit(`Change ${effect.effectName} ${key}`, (current) =>
        patchProjectState(current, {
          effects: setEffectParameter(current.effects, effect.id, key, value),
        }),
      );
      const latest = host.getProject();
      return describeEffect(findEffect(latest, effect.id), latest);
    },
  },
  {
    name: "update_effect",
    description:
      "Turns an effect on or off (bypass), or moves it to another position in its stack.",
    inputSchema: objectSchema(
      {
        effectId: EFFECT_ID,
        enabled: { type: "boolean", description: "On, or bypassed." },
        index: {
          type: "integer",
          description: "Its new position in the stack, 0 for first.",
          minimum: 0,
        },
      },
      ["effectId"],
    ),
    edits: true,
    run(host, input) {
      const effect = findEffect(
        host.getProject(),
        requireString(input, "effectId"),
      );
      const enabled = optionalBoolean(input, "enabled");
      const index = optionalNumber(input, "index");
      host.commit(`Change ${effect.effectName}`, (current) => {
        let effects = current.effects;
        if (enabled !== undefined) {
          effects = setEffectEnabled(effects, effect.id, enabled);
        }
        if (index !== undefined) {
          effects = moveEffect(effects, effect.id, index);
        }
        return patchProjectState(current, { effects });
      });
      const latest = host.getProject();
      return describeEffect(findEffect(latest, effect.id), latest);
    },
  },
  {
    name: "remove_effect",
    description:
      "Removes an effect from its stack. A layer's own Layout effect can't be removed.",
    inputSchema: objectSchema({ effectId: EFFECT_ID }, ["effectId"]),
    edits: true,
    run(host, input) {
      const project = host.getProject();
      const effect = findEffect(project, requireString(input, "effectId"));
      if (removeEffect(project.effects, effect.id) === project.effects) {
        throw new ControlFailure(
          "unavailable",
          "A layer's Layout effect can't be removed.",
        );
      }
      host.commit(`Remove ${effect.effectName}`, (current) =>
        patchProjectState(current, {
          effects: removeEffect(current.effects, effect.id),
        }),
      );
      return { removed: effect.id };
    },
  },
];
