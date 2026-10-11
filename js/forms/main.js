import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createShape, createStars } from './shapeUtils.js';
import { initAudioContext, setupAudio, playShapeNote } from './audioUtils.js';
import { startDecay } from '../decay/index.js';

let camera, scene, renderer, controls;
let shapes = [];
const boundarySize = 10;
let showcaseMode = true;
let lastShapeCreationTime = 0;
// tempo: the portfolio's FORMS layer, slowed to ~0.6× — a new shape every 0.6–2.7 s, at most 7
const MIN_SHOWCASE_INTERVAL = 600;
const MAX_SHOWCASE_INTERVAL = 2700;
const MAX_SHAPES = 7;
const SHAPE_R = 0.5; // fallback radius; each shape carries its own in userData.r
let nextShapeInterval = MIN_SHOWCASE_INTERVAL;
let activeOscillators = [];
let raycaster, mouse;
let showcaseShapeQueue = [];
let cameraAngle = 0;
let cameraRadius = 15;
let speedOscillator = 0;
const speedOscillationRate = 0.0025;
const speedOscillationAmount = 0.5;
let audioEffects = null;
let decay = null;

async function init() {
  // Wait for the experience to be started by the user
  if (!window.experienceStarted) {
    console.log('Waiting for user to start experience...');
    requestAnimationFrame(init);
    return;
  }

  try {
    // Initialize audio first
    await initAudioContext();
    audioEffects = await setupAudio();
    console.log('Audio initialization complete');

    // Initialize Three.js scene
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 15;

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const boundaryGeometry = new THREE.BoxGeometry(boundarySize, boundarySize, boundarySize);
    const edges = new THREE.EdgesGeometry(boundaryGeometry);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const boundaryCube = new THREE.LineSegments(edges, lineMaterial);
    scene.add(boundaryCube);

    createStars(scene);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.25;
    controls.screenSpacePanning = false;
    controls.maxPolarAngle = Math.PI / 2;
    controls.enabled = false;

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();

    decay = await startDecay({ renderer, audioEffects });

    setupEventListeners();
    prepareShowcaseShapes();
    animate();
    
    console.log('Three.js initialization complete');
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

function setupEventListeners() {
  document.addEventListener('click', initAudioContext);
  renderer.domElement.addEventListener('click', onDocumentClick);
  renderer.domElement.addEventListener('touchstart', onDocumentTouch);
  
  const fullscreenButton = document.getElementById('fullscreenButton');
  fullscreenButton.addEventListener('click', toggleFullscreen);
  fullscreenButton.addEventListener('touchstart', toggleFullscreen);

  const showcaseButton = document.getElementById('showcaseButton');
  showcaseButton.addEventListener('click', toggleShowcaseMode);
  showcaseButton.addEventListener('touchstart', toggleShowcaseMode);

  window.addEventListener('resize', onWindowResize, false);

  document.querySelectorAll('.control-button').forEach(button => {
    button.addEventListener('mouseover', function() {
      const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16);
      this.style.backgroundColor = randomColor;
    });

    button.addEventListener('mouseout', function() {
      this.style.backgroundColor = '#000000';
    });
  });
}

function onDocumentClick(event) {
  event.preventDefault();
  if (!showcaseMode) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    createShapeAtMouse();
  }
}

function onDocumentTouch(event) {
  event.preventDefault();
  if (!showcaseMode) {
    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (touch.clientY / window.innerHeight) * 2 + 1;
    createShapeAtMouse();
  }
}

function createShapeAtMouse() {
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects(scene.children);
  
  if (intersects.length > 0) {
    createShape(scene, shapes, boundarySize, audioEffects, activeOscillators, intersects[0].point);
  } else {
    createShape(scene, shapes, boundarySize, audioEffects, activeOscillators);
  }
}

function toggleFullscreen(event) {
  event.preventDefault();
  if (!document.fullscreenElement) {
    document.body.requestFullscreen().then(() => {
      setTimeout(onWindowResize, 100);
    });
  } else {
    document.exitFullscreen().then(() => {
      setTimeout(onWindowResize, 100);
    });
  }
}

function toggleShowcaseMode(event) {
  event.preventDefault();
  showcaseMode = !showcaseMode;
  if (showcaseMode) {
    controls.enabled = false;
    event.target.textContent = 'Interactive Mode';
    prepareShowcaseShapes();
    lastShapeCreationTime = Date.now();
    cameraAngle = 0;
  } else {
    controls.enabled = true;
    event.target.textContent = 'Showcase Mode';
    showcaseShapeQueue = [];
  }
}

function prepareShowcaseShapes() {
  const shapesToAdd = MAX_SHAPES - shapes.length;
  for (let i = 0; i < shapesToAdd; i++) {
    const shape = createShape(scene, shapes, boundarySize, audioEffects, activeOscillators, null, false);
    if (shape) showcaseShapeQueue.push(shape);
  }
}

function getRandomInterval() {
  return Math.random() * (MAX_SHOWCASE_INTERVAL - MIN_SHOWCASE_INTERVAL) + MIN_SHOWCASE_INTERVAL;
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  adjustCameraPosition();
}

function adjustCameraPosition() {
  const aspectRatio = window.innerWidth / window.innerHeight;
  const verticalFOV = camera.fov * (Math.PI / 180);
  const height = 2 * Math.tan(verticalFOV / 2) * camera.position.z;
  const width = height * aspectRatio;

  const desiredWidth = boundarySize * 1.2;
  const desiredHeight = boundarySize * 1.2;

  const scaleFactor = Math.max(desiredWidth / width, desiredHeight / height);
  camera.position.z = camera.position.z * scaleFactor;

  controls.target.set(0, 0, 0);
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);

  speedOscillator += speedOscillationRate;
  const speedFactor = 1 + Math.sin(speedOscillator) * speedOscillationAmount;

  if (showcaseMode) {
    cameraAngle += 0.0006;
    cameraRadius = 15 + Math.sin(cameraAngle * 0.5) * 8;
    camera.position.x = cameraRadius * Math.cos(cameraAngle);
    camera.position.z = cameraRadius * Math.sin(cameraAngle);
    camera.lookAt(scene.position);

    const currentTime = Date.now();
    if (currentTime - lastShapeCreationTime > nextShapeInterval && shapes.length < MAX_SHAPES) {
      if (showcaseShapeQueue.length === 0) {
        prepareShowcaseShapes();
      }
      const shape = showcaseShapeQueue.shift();
      if (shape) {
        scene.add(shape);
        shapes.push(shape);
        lastShapeCreationTime = currentTime;
        nextShapeInterval = getRandomInterval();
        playShapeNote(shape, activeOscillators, audioEffects);
      }
    }
  }

  shapes.forEach((shape) => {
    shape.position.add(shape.velocity.clone().multiplyScalar(speedFactor));

    let bounced = false;
    ['x', 'y', 'z'].forEach(axis => {
      const lim = boundarySize / 2 - (shape.userData.r || SHAPE_R);
      if (shape.position[axis] < -lim || shape.position[axis] > lim) {
        shape.position[axis] = Math.max(-lim, Math.min(lim, shape.position[axis]));
        shape.velocity[axis] *= -1;
        shape.material.color.setHex(Math.random() * 0xffffff);
        playShapeNote(shape, activeOscillators, audioEffects);
        bounced = true;
      }
    });

    if (bounced) {
      shape.bounceCount++;
      // as on the portfolio: out of bounces, it keeps flying while it fades away
      if (shape.bounceCount >= shape.maxBounces) shape.userData.dying = true;
    }
  });

  // gone once the renderer has faded it out (or, failing that, a few bounces later)
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.userData.faded || s.bounceCount >= s.maxBounces + 8) {
      scene.remove(s);
      s.geometry.dispose();
      s.material.dispose();
      shapes.splice(i, 1);
    }
  }

  if (!showcaseMode) {
    controls.update();
  }
  decay.render(scene, camera);
}

init();