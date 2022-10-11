// Replace core vision mode
Hooks.once("init", () => {
  CONFIG.Canvas.visionModes.darkvision = new VisionMode({
    id: "darkvision",
    label: "VISION.ModeDarkvision",
    canvas: {
      shader: ColorAdjustmentsSamplerShader,
      uniforms: { enable: true, contrast: 0, saturation: -1.0, brightness: 0 },
    },
    lighting: {
      background: { visibility: VisionMode.LIGHTING_VISIBILITY.REQUIRED },
    },
    vision: {
      darkness: { adaptive: true },
      defaults: { contrast: 0.05, saturation: -1.0, brightness: 0.75 },
    },
  });

  CONFIG.Canvas.visionModes.devilsSight = new VisionMode({
    id: "devilsSight",
    label: "Devil's Sight",
    canvas: {
      shader: ColorAdjustmentsSamplerShader,
      uniforms: { enable: true, contrast: 0, saturation: 0, brightness: 0 },
    },
    lighting: {
      background: { visibility: VisionMode.LIGHTING_VISIBILITY.REQUIRED },
    },
    vision: {
      darkness: { adaptive: true },
      defaults: { contrast: 0, saturation: 0, brightness: 0.75, range: 120 },
    },
  });
});

// Register setting
Hooks.once("setup", () => {
  game.settings.register("adequate-vision", "linkActorSenses", {
    name: "Link Actor Senses (In Testing!)",
    hint: "Automatically add and remove vision/detection modes according to the senses possessed by each token's corresponding actor. Currently only supported for PCs.",
    scope: "world",
    config: true,
    default: false,
    requiresReload: true,
    type: Boolean,
  });
});

// Update token sources every time a scene is viewed, including on initial load
Hooks.on("canvasReady", () => {
  const tokens = canvas.scene?.tokens.contents ?? [];
  const actors = new Set(tokens.flatMap((t) => t.actor ?? []));
  for (const actor of actors) {
    updateTokens(actor);
  }
});

// Update token sources when an actor's senses are updated
Hooks.on("updateActor", (actor, changes, context, userId) => {
  const hasSensesUpdate = Object.keys(flattenObject(changes)).some((c) => c.startsWith("system.attributes.senses"));
  if (hasSensesUpdate) {
    updateTokens(actor);
  }
});

// Handle addition and removal of Devil's Sight
Hooks.on("createActiveEffect", (effect) => {
  // Could use a better check than a localization-unfriendly label
  if (effect.parent instanceof Actor) {
    updateTokens(effect.parent);
  }
});

Hooks.on("deleteActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) {
    updateTokens(effect.parent);
  }
});

// Update token sources when a token is updated
Hooks.on("updateToken", (token, changes, context, userId) => {
  if (!token.actor) return;

  const changesKeys = Object.keys(flattenObject(changes));
  if (changesKeys.some((k) => k.startsWith("sight") || k.startsWith("detectionModes"))) {
    updateTokens(token.actor);
  }
});

function updateTokens(actor) {
  // Only make updates if the following are true
  const linkActorSenses = game.settings.get("adequate-vision", "linkActorSenses");
  const tokenVisionEnabled = !!canvas.scene?.tokenVision;
  const userIsObserver = actor.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const checks = [linkActorSenses, tokenVisionEnabled, userIsObserver, actor.type === "character"];
  if (!checks.every((c) => c)) return;

  const handledSenses = ["darkvision", "blindsight", "tremorsense"];
  const modes = Object.entries(actor.system.attributes.senses)
    .filter(([sense, range]) => handledSenses.includes(sense) && typeof range === "number" && range > 0)
    .reduce((entries, [sense, range]) => ({ ...entries, [sense]: range }), {});
  if (actor.effects.some((e) => e.label === "Devil's Sight" && !e.disabled && !e.isSuppressed)) {
    modes.devilsSight = 120;
  }

  let madeUpdates = false;
  const tokens = actor.getActiveTokens(false, true).filter((t) => t.sight.enabled);
  for (const token of tokens) {
    const updates = {};
    const { sight, detectionModes } = token;

    // Devil's sight and darkvision
    if (modes.devilsSight && (sight.visionMode !== "devilsSight" || sight.range !== mode.devilsSight)) {
      const defaults = CONFIG.Canvas.visionModes.devilsSight.vision.defaults;
      updates.sight = { visionMode: "devilsSight", ...defaults };
    } else if (modes.darkvision && (sight.visionMode !== "darkvision" || sight.range !== modes.darkvision)) {
      const defaults = CONFIG.Canvas.visionModes.darkvision.vision.defaults;
      updates.sight = { visionMode: "darkvision", ...defaults, range: modes.darkvision };
    } else {
      updates.sight = { visionMode: "basic", contrast: 0, brightness: 0, saturation: 0, range: null };
    }

    // Tremorsense
    if (modes.tremorsense) {
      const hasFeelTremor = detectionModes.some((m) => m.id === "feelTremor" && m.range === mode.tremorsense);
      if (!hasFeelTremor) {
        updates.detectionModes = [
          { id: "feelTremor", enabled: true, range: modes.tremorsense },
          ...token._source.detectionModes.filter((m) => m.id !== "feelTremor"),
        ];
      }
    } else if (detectionModes.some((m) => m.id === "feelTremor")) {
      updates.detectionModes = token._source.detectionModes.filter((m) => m.id !== "feelTremor");
    }

    // Update?
    if (Object.keys(updates).length > 0) {
      token.updateSource(updates);
      madeUpdates = true;
    }
  }

  // Reinitialize vision and refresh lighting
  if (madeUpdates && (game.user.character || canvas.tokens.controlled.length > 0)) {
    canvas.perception.update({ initializeVision: true, refreshLighting: true }, true);
  }
}
