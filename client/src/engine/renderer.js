// WebGL renderer + post-processing chain (bloom, vignette) with quality tiers.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';

export class RendererSys {
  constructor(G, canvas) {
    this.G = G;
    const q = G.settings.quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: q !== 'low',
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = q === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.usePost = q !== 'low';
    this.composer = null;
    this.bloom = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildComposer() {
    const { renderer, G } = this;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(G.scene, G.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.65, 0.85);
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.offset.value = 0.92;
    this.vignette.uniforms.darkness.value = 1.15;
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const scale = this.G.settings.resolutionScale;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * scale;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    if (this.G.camera) {
      this.G.camera.aspect = w / h;
      this.G.camera.updateProjectionMatrix();
    }
  }

  render() {
    const { G } = this;
    if (this.usePost) {
      if (!this.composer) this.buildComposer();
      // stronger bloom at night for neon/headlight glow
      this.bloom.strength = 0.28 + (1 - (G.daynight?.sunFactor ?? 1)) * 0.35;
      this.composer.render();
    } else {
      this.renderer.render(G.scene, G.camera);
    }
  }
}
