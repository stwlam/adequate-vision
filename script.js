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
      defaults: { contrast: 0, saturation: -1.0, brightness: 0.65 },
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
      defaults: { contrast: 0, saturation: 0, brightness: 0.65, range: 120 },
    },
  });

  CONFIG.Canvas.detectionModes.blindsight = new BlindDetectionMode();
  CONFIG.Canvas.detectionModes.seeInvisibility = new InvisibilityDetectionMode();
});

// Register setting
Hooks.once("setup", () => {
  game.settings.register("adequate-vision", "linkActorSenses", {
    name: "Link Actor Senses (In Testing!)",
    hint: "Automatically manage vision/detection modes according to the senses possessed by each token's corresponding actor. Currently only supported for PCs.",
    scope: "world",
    config: true,
    default: true,
    requiresReload: true,
    type: Boolean,
  });
});

// Update token sources when the game is ready
Hooks.once("ready", () => {
  onReady();
});

// Update token sources every time a scene is viewed
Hooks.on("canvasReady", () => {
  if (game.ready) onReady();
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

// Update when a new token is added to a scene
Hooks.on("createToken", (token, context, userId) => {
  if (token.actor) {
    Promise.resolve().then(() => {
      updateTokens(token.actor);
    });
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

function onReady() {
  const tokens = canvas.scene?.tokens.contents ?? [];
  const actors = new Set(tokens.flatMap((t) => t.actor ?? []));
  for (const actor of actors) {
    updateTokens(actor, { force: true });
  }
}

function updateTokens(actor, { force = false } = {}) {
  // Only make updates if the following are true
  const linkActorSenses = game.settings.get("adequate-vision", "linkActorSenses");
  const tokenVisionEnabled = !!canvas.scene?.tokenVision;
  const userIsObserver = actor.getUserLevel(game.user) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
  const checks = [linkActorSenses, tokenVisionEnabled, userIsObserver, actor.type === "character"];
  if (!checks.every((c) => c)) return;

  const handledSenses = ["darkvision", "blindsight", "tremorsense", "truesight"];
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
    const canSeeInDark = ["darkvision", "devilsSight", "truesight"].some((m) => !!modes[m]);

    // Devil's sight and darkvision
    if (modes.devilsSight && (sight.visionMode !== "devilsSight" || sight.range !== modes.devilsSight)) {
      const defaults = CONFIG.Canvas.visionModes.devilsSight.vision.defaults;
      updates.sight = { visionMode: "devilsSight", ...defaults };
    } else if (modes.darkvision && (sight.visionMode !== "darkvision" || sight.range !== modes.darkvision)) {
      const defaults = CONFIG.Canvas.visionModes.darkvision.vision.defaults;
      updates.sight = { visionMode: "darkvision", ...defaults, range: modes.darkvision };
    } else if (!canSeeInDark && token.sight.visionMode !== "basic" && token.sight.range !== null) {
      updates.sight = { visionMode: "basic", contrast: 0, brightness: 0, saturation: 0, range: null };
    }

    // Blindsight
    if (modes.blindsight) {
      updates.detectionModes ??= [];
      updates.detectionModes.push({ id: "blindsight", enabled: true, range: modes.blindsight });
    }

    // Truesight
    if (modes.truesight && sight.visionMode !== "devilsSight") {
      const defaults = CONFIG.Canvas.visionModes.devilsSight.vision.defaults;
      const range = Math.max(modes.truesight, modes.devilsSight ?? 0);
      updates.sight = { visionMode: "devilsSight", ...defaults, range };
      updates.detectionModes ??= [];
      updates.detectionModes.push({ id: "seeInvisibility", enabled: true, range: modes.truesight });
    }

    // Tremorsense
    if (modes.tremorsense) {
      const hasFeelTremor = detectionModes.some((m) => m.id === "feelTremor" && m.range === mode.tremorsense);
      if (!hasFeelTremor) {
        updates.detectionModes ??= [];
        updates.detectionModes.push({ id: "feelTremor", enabled: true, range: modes.tremorsense });
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
  if (madeUpdates || force) {
    canvas.perception.update({ initializeVision: true, refreshLighting: true }, true);
  }
}

class BlindDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "blindsight",
      label: "Blindsight",
      type: DetectionMode.DETECTION_TYPES.SIGHT,
    });
  }

  /** @override */
  static getDetectionFilter() {
    const filter = (this._detectionFilter ??= OutlineOverlayFilter.create({
      wave: true,
      knockout: false,
    }));
    filter.thickness = 1;
    return filter;
  }

  /** @override */
  _canDetect(visionSource, target) {
    return target instanceof Token || target instanceof DoorControl;
  }
}

class InvisibilityDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "seeInvisibility",
      label: "DETECTION.SeeInvisibility",
      type: DetectionMode.DETECTION_TYPES.SIGHT,
    });
  }

  /** @override */
  static getDetectionFilter() {
    return this._detectionFilter ??= GlowOverlayFilter.create({
      glowColor: [0, 0.60, 0.33, 1]
    });
  }

  /** @override */
  _canDetect(visionSource, target) {
    const source = visionSource.object;

    // Only invisible tokens can be detected; the vision source must not be blinded
    return !(source instanceof Token
      && source.document.hasStatusEffect(CONFIG.specialStatusEffects.BLIND))
      && target instanceof Token
      && target.document.hasStatusEffect(CONFIG.specialStatusEffects.INVISIBLE);
  }

  /** @override */
  _testPoint(visionSource, mode, target, test) {
    const statusId = CONFIG.specialStatusEffects.INVISIBLE;
    let effects;

    // Temporarily remove the invisible status effect from the target (see TokenDocument#hasStatusEffect)
    if (!target.actor) {
      const icon = CONFIG.statusEffects.find(e => e.id === statusId)?.icon;

      effects = this.effects;
      this.effects = this.effects.filter(e => e !== icon);
    } else {
      effects = target.actor.effects.filter(e => !e.disabled && e.getFlag("core", "statusId") === statusId);
      effects.forEach(e => e.disabled = true);
    }

    // Test visibility without the invisible status effect
    const isVisible = canvas.effects.visibility.testVisibility(test.point, { tolerance: 0, object: target });

    // Restore the status effect
    if (!target.actor) {
      this.effects = effects;
    } else {
      effects.forEach(e => e.disabled = false);
    }

    return isVisible;
  }
}
