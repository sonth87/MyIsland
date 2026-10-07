export { App, type AppOptions, type System } from './core/App';
export { Input, type ClickHandler } from './input/Input';
export { toonMaterial, toonGradient } from './render/toon';
export { windToonMaterial, createWindUniforms, type WindUniforms } from './render/wind';
export { OutlinePass, type OutlineParams } from './render/OutlinePass';
export { createStylizedPipeline, type StylizedOptions, type StylizedPipeline } from './render/pipeline';
export { damp, dampFactor, dampVector, easeInOutCubic } from './camera/damp';
export { applyPose, copyPose, createPose, PoseTransition, type CameraPose } from './camera/Pose';
export { createRng, randPick, randRange, type Rng } from './world/rng';
export { createNoise, type NoiseSet } from './world/noise';
export { SpatialHash } from './world/SpatialHash';
export * as lowpoly from './props/lowpoly';
export { createDebug, DEBUG, type DebugTools } from './debug/debug';
export {
  ENV,
  envMaterial,
  envDepthMaterial,
  envNormalMaterial,
  patchEnv,
  setEnvWorld,
  type EnvOptions,
  type SwayKind,
} from './env/envShader';
export { WorldClock, formatHour, hourIcon, type TimeMode } from './env/WorldClock';
export { Weather, LEVEL_NAMES, levelOf } from './env/Weather';
export { Sky, skyState, haloTexture, type SkyState } from './env/Sky';
export { Precipitation } from './env/Precipitation';
export { Leaves, SEASON_LEAF_STYLE, type LeafSource, type LeafStyle, type LeavesOptions } from './env/Leaves';
export type { Surface, Level, WeatherControls } from './env/Surface';
export { SoundScape, type StepSurface } from './audio/SoundScape';
export { CharacterView, type Outfit, type Action } from './character/CharacterView';
export { treeVariants, DEFAULT_TREE_COLORS, type TreeSpecies, type TreeVariant, type TreeColors } from './props/trees';
export { LodInstances, type LodItem, type LodLevel, type LodOptions } from './lod/LodInstances';
export { Critters, type CritterKind, type CritterSpawner } from './life/Critters';
export { Pond, type PadSpot, type WaterSpawner } from './life/Pond';
export { setQuality, getQuality, q } from './render/quality';
export { SeasonState, SEASONS, SEASON_LABEL, SEASON_ICON, ACTIVITY, SOUND, seasonIndex, type Season, type SeasonMood, type PerSeason } from './env/Season';
export { Fireflies } from './life/Fireflies';
export { SEASON_KIND, seasonKind, type SeasonKind } from './props/lowpoly';
export { detectDevice, type DeviceInfo, type DeviceTier } from './core/device';
export { AdaptiveQuality, type AdaptiveOptions, type Rung } from './core/AdaptiveQuality';
