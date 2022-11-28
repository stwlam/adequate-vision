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
  CONFIG.Canvas.detectionModes.devilsSight = new DevilsSightDetectionMode();
  CONFIG.Canvas.detectionModes.echolocation = new EcholocationDetectionMode();
  CONFIG.Canvas.detectionModes.feelTremor.updateSource({ label: "DND5E.SenseTremorsense" });
  CONFIG.Canvas.detectionModes.seeAll.updateSource({ label: "DND5E.SenseTruesight" });
  CONFIG.Canvas.detectionModes.seeInvisibility = new InvisibilityDetectionMode();

  CONFIG.specialStatusEffects.DEAF = "deaf";
});

// Register setting
Hooks.once("setup", () => {
  game.settings.register("adequate-vision", "linkActorSenses", {
    name: "Link Actor Senses (In Testing!)",
    hint: "Automatically manage vision/detection modes according to the senses possessed by each token's corresponding actor.",
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
  if (hasProperty(changes, "system.attributes.senses")) {
    updateTokens(actor);
  }
});

// Handle updates of actor senses via AEs
Hooks.on("createActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) {
    updateTokens(effect.parent);
  }
});
Hooks.on("updateActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) {
    updateTokens(effect.parent);
  }
});
Hooks.on("deleteActiveEffect", (effect) => {
  if (effect.parent instanceof Actor) {
    updateTokens(effect.parent);
  }
});

// Process when a new token is added or updated
Hooks.on("createToken", (token, context, userId) => {
  if (token.actor) {
    Promise.resolve().then(() => {
      updateTokens(token.actor);
    });
  }
});
Hooks.on("updateToken", (token, changes, context, userId) => {
  if (!token.actor) return;
  if ("sight" in changes || "detectionModes" in changes) {
    updateTokens(token.actor);
  }
});

Hooks.on("renderTokenConfig", (sheet, html) => {
  if (!game.settings.get("adequate-vision", "linkActorSenses")) return;
  // Disable input fields that are automatically managed
  html[0].querySelectorAll(`
    [name="sight.range"],
    [name="sight.visionMode"],
    [name="sight.brightness"],
    [name="sight.saturation"],
    [name="sight.contrast"],
    [name^="detectionModes."]`)
    .forEach((e) => {
      e.disabled = true;

      if (e.name.startsWith("sight.")) {
        e.dataset.tooltip = "Managed by Adequate Vision";
        e.dataset.tooltipDirection = "LEFT";
      }

      if (e.type === "range") {
        e.style.filter = "grayscale(1.0) opacity(0.33)";
        e.parentNode.querySelector(`.range-value`).style.filter = "opacity(0.67)";
      }
    });
  // Remove the buttons to add/remove detection modes
  html[0].querySelectorAll(`.detection-mode-controls`)
    .forEach((e) => e.remove());
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
  const checks = [linkActorSenses, tokenVisionEnabled, userIsObserver, ["character", "npc"].includes(actor.type)];
  if (!checks.every((c) => c)) return;

  const handledSenses = ["darkvision", "blindsight", "tremorsense", "truesight"];
  const modes = Object.entries(actor.system.attributes.senses)
    .filter(([sense, range]) => handledSenses.includes(sense) && typeof range === "number" && range > 0)
    .reduce((entries, [sense, range]) => ({ ...entries, [sense]: range }), {});

  // Could use a better check than a localization-unfriendly label
  for (const effect of actor.effects) {
    if (effect.disabled || effect.isSuppressed) continue;
    switch (effect.label) {
      case "Devil's Sight":
        modes.devilsSight = 120;
        break;
      case "See Invisibility":
        modes.seeInvisibility = 10000;
        break;
      case "Echolocation":
        if (modes.blindsight) {
          modes.echolocation = modes.blindsight;
          delete modes.blindsight;
        }
        break;
    }
  }

  let madeUpdates = false;
  const tokens = actor.getActiveTokens(false, true).filter((t) => t.sight.enabled);
  for (const token of tokens) {
    const updates = {};

    // VISION MODES

    if (modes.devilsSight || modes.truesight) {
      const defaults = CONFIG.Canvas.visionModes.devilsSight.vision.defaults;
      const range = Math.max(modes.truesight ?? 0, modes.devilsSight ?? 0);
      updates.sight = { visionMode: "devilsSight", ...defaults, range };
    } else if (modes.darkvision) {
      const defaults = CONFIG.Canvas.visionModes.darkvision.vision.defaults;
      updates.sight = { visionMode: "darkvision", ...defaults, range: modes.darkvision };
    } else {
      const defaults = CONFIG.Canvas.visionModes.basic.vision.defaults;
      updates.sight = { visionMode: "basic", ...defaults, range: 0 };
    }

    // Don't override vision tint and attenuation set by the user
    delete updates.sight.attenuation;
    delete updates.sight.color

    // DETECTION MODES

    updates.detectionModes = [];

    // Devil's sight
    if (modes.devilsSight) {
      updates.detectionModes.push({ id: "devilsSight", enabled: true, range: modes.devilsSight });
    }

    // Truesight
    if (modes.truesight) {
      updates.detectionModes.push({ id: "seeAll", enabled: true, range: modes.truesight });
    }

    // See Invisibility
    if (modes.seeInvisibility) {
      updates.detectionModes.push({ id: "seeInvisibility", enabled: true, range: modes.seeInvisibility });
    }

    // Blindsight
    if (modes.blindsight) {
      updates.detectionModes.push({ id: "blindsight", enabled: true, range: modes.blindsight });
    }

    // Echolocation
    if (modes.echolocation) {
      updates.detectionModes.push({ id: "echolocation", enabled: true, range: modes.echolocation });
    }

    // Tremorsense
    if (modes.tremorsense) {
      updates.detectionModes.push({ id: "feelTremor", enabled: true, range: modes.tremorsense });
    }

    // Note: At the moment (10.290) `updateSource` doesn't return the correct diff (#8503).
    // So we need to diff `updates` with the source data ourselves until it's fixed.
    const changes = diffObject(token.toObject(), updates);
    if (!isEmpty(changes)) {
      token.updateSource(changes);
      madeUpdates = true;
    }
  }

  // Reinitialize vision and refresh lighting
  if (madeUpdates || force) {
    canvas.perception.update({ initializeVision: true, refreshLighting: true }, true);
  }
}

function testAngle(visionSource, point) {
  const { angle, rotation, externalRadius } = visionSource.data;
  if (angle !== 360) {
    const dx = point.x - visionSource.x;
    const dy = point.y - visionSource.y;
    if (dx * dx + dy * dy > externalRadius * externalRadius) {
      const aMin = rotation + 90 - angle / 2;
      const a = Math.toDegrees(Math.atan2(dy, dx));
      if ((((a - aMin) % 360) + 360) % 360 > angle) {
        return false;
      }
    }
  }
  return true;
}

class BlindDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "blindsight",
      label: "DND5E.SenseBlindsight",
      type: DetectionMode.DETECTION_TYPES.OTHER,
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
    return true;
  }

  /** @override */
  _testLOS(visionSource, mode, target, test) {
    // Blindsight is restricted by total cover
    return !CONFIG.Canvas.losBackend.testCollision(
      { x: visionSource.x, y: visionSource.y },
      test.point,
      { type: "move", mode: "any", source: visionSource }
    );
  }
}

class DevilsSightDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "devilsSight",
      label: "Devil's Sight",
      type: DetectionMode.DETECTION_TYPES.SIGHT,
    });
  }

  /** @override */
  static getDetectionFilter() {
    const filter = (this._detectionFilter ??= OutlineOverlayFilter.create({
      outlineColor: [0.85, 0.85, 1.0, 1],
      knockout: true,
    }));
    return filter;
  }
}

class EcholocationDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "echolocation",
      label: "Echolocation",
      type: DetectionMode.DETECTION_TYPES.SOUND,
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
    // Echolocation doesn't work while deafened.
    const source = visionSource.object;
    return !(source instanceof Token && source.document.hasStatusEffect(CONFIG.specialStatusEffects.DEAF));
  }

  /** @override */
  _testLOS(visionSource, mode, target, test) {
    // Echolocation is directional and therefore limited by the vision angle.
    if (!testAngle(visionSource, test.point)) return false;
    // Echolocation is blocked by total cover and sound restrictions.
    return !(
      CONFIG.Canvas.losBackend.testCollision({ x: visionSource.x, y: visionSource.y }, test.point, {
        type: "move",
        mode: "any",
        source: visionSource,
      }) ||
      CONFIG.Canvas.losBackend.testCollision({ x: visionSource.x, y: visionSource.y }, test.point, {
        type: "sound",
        mode: "any",
        source: visionSource,
      })
    );
  }
}

class InvisibilityDetectionMode extends DetectionMode {
  constructor() {
    super({
      id: "seeInvisibility",
      label: "DETECTION.SeeInvisibility",
      type: DetectionMode.DETECTION_TYPES.SIGHT,
      walls: false,
    });
  }

  /** @override */
  static getDetectionFilter() {
    return (this._detectionFilter ??= GlowOverlayFilter.create({ glowColor: [0, 0.6, 0.33, 1] }));
  }

  /** @override */
  _canDetect(visionSource, target) {
    // Only invisible tokens can be detected
    return target instanceof Token && target.document.hasStatusEffect(CONFIG.specialStatusEffects.INVISIBLE);
  }

  /** @override */
  _testPoint(visionSource, mode, target, test) {
    if (!this._testRange(visionSource, mode, target, test)) {
      return false;
    }

    const source = visionSource.object;
    const statusId = CONFIG.specialStatusEffects.INVISIBLE;
    let effects, detectionModes;

    // Temporarily remove all detection modes that are not sight-based from the source
    if (source instanceof Token) {
      detectionModes = source.document.detectionModes;
      source.document.detectionModes = detectionModes.filter(
        (m) => CONFIG.Canvas.detectionModes[m.id]?.type === DetectionMode.DETECTION_TYPES.SIGHT
      );
    }

    // Temporarily remove the invisible status effect from the target (see TokenDocument#hasStatusEffect)
    if (!target.actor) {
      const icon = CONFIG.statusEffects.find((e) => e.id === statusId)?.icon;

      effects = this.effects;
      this.effects = this.effects.filter((e) => e !== icon);
    } else {
      effects = target.actor.effects.filter((e) => !e.disabled && e.getFlag("core", "statusId") === statusId);
      for (const effect of effects) {
        effect.disabled = true;
      }
    }

    // Test sight-based visibility without the invisible status effect
    const isVisible = canvas.effects.visibility.testVisibility(test.point, { tolerance: 0, object: target });

    // Restore the detection modes
    if (detectionModes) {
      source.document.detectionModes = detectionModes;
    }

    // Restore the status effect
    if (!target.actor) {
      this.effects = effects;
    } else {
      for (const effect of effects) {
        effect.disabled = false;
      }
    }

    return isVisible;
  }
}
