import * as THREE from 'three';
import { playShapeNote } from './audioUtils.js';

export const createShape = (scene, shapes, boundarySize, audioEffects, activeOscillators, position = null, addToScene = true) => {
  const MAX_SHAPES = 7;
  if (shapes.length >= MAX_SHAPES) return null;

  const shapeType = Math.floor(Math.random() * 3);
  let geometry;
  switch (shapeType) {
    case 0: geometry = new THREE.SphereGeometry(0.5, 32, 32); break;
    case 1: geometry = new THREE.TetrahedronGeometry(0.5, 0); break;
    case 2: geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5); break;
  }
  
  const material = new THREE.MeshBasicMaterial({ color: Math.random() * 0xffffff, wireframe: true });
  const shape = new THREE.Mesh(geometry, material);
  
  // portfolio sizes (radius 0.07–0.13 of a 1.12 half-box) ×1.4, scaled to this box
  shape.userData.r = (0.07 + Math.random() * 0.06) * 1.4 * (boundarySize / 2 / 1.12);
  const lim = boundarySize / 2 - shape.userData.r;
  if (position) {
    shape.position.copy(position).clampScalar(-lim, lim);
  } else {
    shape.position.x = (Math.random() * 2 - 1) * lim;
    shape.position.y = (Math.random() * 2 - 1) * lim;
    shape.position.z = (Math.random() * 2 - 1) * lim;
  }
  
  // portfolio speed (0.0035–0.0075 of a 1.12 half-box per frame) scaled to this box, slowed to ~0.6×
  const speed = 0.0094 + Math.random() * 0.0107;
  shape.velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
    .normalize()
    .multiplyScalar(speed);
  
  shape.bounceCount = 0;
  shape.maxBounces = Math.floor(Math.random() * 6) + 5;
  
  if (addToScene) {
    scene.add(shape);
    shapes.push(shape);
    playShapeNote(shape, activeOscillators, audioEffects);
  }
  
  return shape;
};

export const createStars = (scene) => {
  const starsGeometry = new THREE.BufferGeometry();
  const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1 });
  const starVertices = [];
  for (let i = 0; i < 1000; i++) {
    const x = (Math.random() - 0.5) * 200;
    const y = (Math.random() - 0.5) * 200;
    const z = (Math.random() - 0.5) * 200;
    starVertices.push(x, y, z);
  }
  starsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);
};