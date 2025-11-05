import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {BoxGeometry} from "three/src/geometries/BoxGeometry.js";
import { colorFromUuid } from "uuid-color";

class CameraAnimation {
    constructor(camera, controls, targetPosition, targetLookAt, duration) {
        this.camera = camera;
        this.controls = controls;
        this.duration = duration;
        this.startTime = Date.now();
        this.startPosition = camera.position.clone();
        this.startLookAt = controls.target.clone();
        this.targetPosition = targetPosition.clone();
        this.targetLookAt = targetLookAt.clone();
        this.isActive = true;
    }

    update() {
        if (!this.isActive) return false;

        const elapsed = Date.now() - this.startTime;
        const progress = Math.min(elapsed / this.duration, 1);
        
        // Ease in-out cubic function for smooth animation
        const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        // Interpolate camera position using manual calculation
        this.camera.position.x = this.startPosition.x + (this.targetPosition.x - this.startPosition.x) * easedProgress;
        this.camera.position.y = this.startPosition.y + (this.targetPosition.y - this.startPosition.y) * easedProgress;
        this.camera.position.z = this.startPosition.z + (this.targetPosition.z - this.startPosition.z) * easedProgress;
        
        // Interpolate look-at target
        this.controls.target.x = this.startLookAt.x + (this.targetLookAt.x - this.startLookAt.x) * easedProgress;
        this.controls.target.y = this.startLookAt.y + (this.targetLookAt.y - this.startLookAt.y) * easedProgress;
        this.controls.target.z = this.startLookAt.z + (this.targetLookAt.z - this.startLookAt.z) * easedProgress;
        this.controls.update();

        if (progress >= 1) {
            this.isActive = false;
            return false;
        }

        return true;
    }

    stop() {
        this.isActive = false;
    }
}

export class Playground {
    camera;
    scene;
    renderer;
    cameraControls;

    ambientLight;
    light;

    /**
     * @type {[THREE.Mesh]}
     */
    boxes = [];

    /**
     * @type {[THREE.Mesh]}
     */
    items = [];

    /**
     * @type {Map<string, THREE.Mesh>}
     */
    boxMap = new Map();

    /**
     * @type {Map<string, THREE.Mesh>}
     */
    itemMap = new Map();

    materials = {};
    animationFrameId = null;
    selectedBox = null;
    onBoxSelect = null;
    animationSpeed = 1;
    showAnimation = true;
    cameraAnimation = null;
    boxList = [];

    constructor(container) {
        this.camera = new THREE.PerspectiveCamera(45, container.offsetWidth / window.innerHeight, 1, 80000);
        this.camera.position.set(-600, 550, 1300);

        this.ambientLight = new THREE.AmbientLight(0x7c7c7c, 3.0);

        this.light = new THREE.DirectionalLight(0xFFFFFF, 3.0);
        this.light.position.set(0.32, 0.39, 0.7);

        const canvasWidth = container.offsetWidth;
        const canvasHeight = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(canvasWidth, canvasHeight);

        container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', (e) => this.onWindowResize(e, container));
        window.addEventListener('keydown', (e) => this.onKeyboard(e));

        this.cameraControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.cameraControls.addEventListener('change', () => this.renderer.render(this.scene, this.camera));
        
        // Add click handler for box selection
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.renderer.domElement.addEventListener('click', (e) => this.onCanvasClick(e));

        this.materials['wireframe'] = new THREE.MeshBasicMaterial({
            wireframe: true,
            color: 0x888888,
            transparent: true,
            opacity: 0.5
        });
        this.materials['wireframe_selected'] = new THREE.MeshBasicMaterial({
            wireframe: true,
            color: 0x00ff00,
            linewidth: 2
        });
        this.materials['flat'] = new THREE.MeshPhongMaterial({
            specular: 0x000000,
            flatShading: true,
            side: THREE.DoubleSide
        });
        this.materials['smooth'] = new THREE.MeshLambertMaterial({side: THREE.DoubleSide});
        this.materials['glossy'] = new THREE.MeshPhongMaterial({side: THREE.DoubleSide});

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a); // Very dark background

        this.scene.add(this.ambientLight);
        this.scene.add(this.light);

        this.animate();
    }

    animate() {
        this.animationFrameId = requestAnimationFrame(() => this.animate());
        
        // Update camera animation if active
        if (this.cameraAnimation) {
            this.cameraAnimation.update();
        }
        
        this.cameraControls.update();
        this.renderer.render(this.scene, this.camera);
    }

    render(request) {
        if (
            request !== undefined
            && typeof request.boxes !== 'undefined'
            && request.boxes.length > 0
        ) {
            this.createObjects(request);
        }
    }

    selectBox(boxId, animate = true) {
        if (this.selectedBox) {
            const oldBox = this.boxMap.get(this.selectedBox);
            if (oldBox) {
                oldBox.material = this.materials['wireframe'];
            }
        }

        this.selectedBox = boxId;
        const box = this.boxMap.get(boxId);
        if (box) {
            box.material = this.materials['wireframe_selected'];
            
            // Calculate optimal camera position
            const boxPosition = box.position.clone();
            const boxData = box.userData.boxData;
            const boxSize = Math.max(boxData.width, boxData.height, boxData.depth);
            
            // Calculate optimal viewing angle
            const diagonal = Math.sqrt(
                boxData.width * boxData.width + 
                boxData.height * boxData.height + 
                boxData.depth * boxData.depth
            );
            const distance = diagonal * 1.5; // Optimal distance for viewing
            
            // Calculate camera position with better angle
            const angle = Math.PI / 4; // 45 degrees
            const height = boxData.height * 0.7; // Slightly above center
            
            const targetPosition = new THREE.Vector3(
                boxPosition.x + Math.cos(angle) * distance,
                boxPosition.y + height,
                boxPosition.z + Math.sin(angle) * distance
            );
            
            const targetLookAt = new THREE.Vector3(
                boxPosition.x,
                boxPosition.y + boxData.height * 0.3,
                boxPosition.z
            );
            
            if (animate && this.cameraAnimation) {
                // Stop current animation
                this.cameraAnimation.stop();
            }
            
            if (animate) {
                // Animate camera movement
                this.cameraAnimation = new CameraAnimation(
                    this.camera,
                    this.cameraControls,
                    targetPosition,
                    targetLookAt,
                    1000 // 1 second animation
                );
            } else {
                // Instant move
                this.camera.position.copy(targetPosition);
                this.cameraControls.target.copy(targetLookAt);
                this.cameraControls.update();
            }
        }

        if (this.onBoxSelect) {
            this.onBoxSelect(boxId);
        }
    }

    selectNextBox() {
        if (this.boxList.length === 0) return;
        
        const currentIndex = this.boxList.findIndex(id => id === this.selectedBox);
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % this.boxList.length;
        this.selectBox(this.boxList[nextIndex]);
    }

    selectPreviousBox() {
        if (this.boxList.length === 0) return;
        
        const currentIndex = this.boxList.findIndex(id => id === this.selectedBox);
        const prevIndex = currentIndex === -1 ? this.boxList.length - 1 : (currentIndex - 1 + this.boxList.length) % this.boxList.length;
        this.selectBox(this.boxList[prevIndex]);
    }

    onWindowResize(e, container) {
        const canvasWidth = container.offsetWidth;
        const canvasHeight = window.innerHeight;

        this.renderer.setSize(canvasWidth, canvasHeight);

        this.camera.aspect = canvasWidth / canvasHeight;
        this.camera.updateProjectionMatrix();

        this.render()
    }

    onKeyboard(e) {
        // Navigation between boxes with Ctrl+Arrow keys
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                this.selectPreviousBox();
                return;
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                this.selectNextBox();
                return;
            }
        }

        // Camera movement with WASD or Arrow keys (without Ctrl)
        const delta = 200;
        switch (e.code) {
            case "KeyA":
                if (!e.ctrlKey && !e.metaKey) {
                    this.camera.position.set(this.camera.position.x - delta, this.camera.position.y, this.camera.position.z)
                }
                break;
            case "KeyW":
                if (!e.ctrlKey && !e.metaKey) {
                    this.camera.position.set(this.camera.position.x, this.camera.position.y, this.camera.position.z - delta)
                }
                break;
            case "KeyD":
                if (!e.ctrlKey && !e.metaKey) {
                    this.camera.position.set(this.camera.position.x + delta, this.camera.position.y, this.camera.position.z)
                }
                break;
            case "KeyS":
                if (!e.ctrlKey && !e.metaKey) {
                    this.camera.position.set(this.camera.position.x, this.camera.position.y, this.camera.position.z + delta)
                }
                break;
        }

        this.cameraControls.update()
    }

    onCanvasClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(this.boxes, true);

        if (intersects.length > 0) {
            // Find the box mesh (not the item mesh)
            let boxMesh = intersects[0].object;
            while (boxMesh && !this.boxMap.has(boxMesh.userData?.boxId)) {
                boxMesh = boxMesh.parent;
            }
            
            if (boxMesh && boxMesh.userData?.boxId) {
                this.selectBox(boxMesh.userData.boxId);
            }
        }
    }

    destroy() {
        for (const item of this.items) {
            item.geometry.dispose()
            if (item.material) item.material.dispose()
            this.scene.remove(item)
        }

        for (const box of this.boxes) {
            box.geometry.dispose()
            this.scene.remove(box)
        }

        this.boxes = []
        this.items = []
        this.boxMap.clear()
        this.itemMap.clear()
        this.selectedBox = null
    }

    createObjects(request) {
        this.destroy()
        
        // Store box list for navigation
        this.boxList = request.boxes.map(box => box.id);

        const delta = 50
        let point = {x: 0, y: 0, z: 0}
        let zMax = 0

        // Create boxes first
        for (const box of request.boxes) {
            const boxGeometry = new BoxGeometry(box.width, box.height, box.depth)
            const boxMesh = new THREE.Mesh(boxGeometry, this.materials['wireframe'])

            point.x += box.width / 2
            boxMesh.position.set(point.x, box.height / 2, point.z)

            this.boxes = this.boxes.concat(boxMesh)
            this.boxMap.set(box.id, boxMesh)
            this.scene.add(boxMesh);

            // Store box data for later use
            boxMesh.userData = {
                boxId: box.id,
                boxData: box,
                items: []
            }

            // Add items with animation
            if (this.showAnimation) {
                this.animateItemsIntoBox(boxMesh, box.items, box);
            } else {
                this.addItemsToBox(boxMesh, box.items, box);
            }

            point.x += box.width / 2 + delta
            zMax = Math.max(box.depth, zMax)
        }

        // Add unfit items
        point = {x: 0, y: 0, z: zMax + delta + 100}

        for (const item of request.items || []) {
            const color = colorFromUuid(item.id)
            const itemGeometry = new BoxGeometry(item.width, item.height, item.depth)
            const itemMaterial = new THREE.MeshPhongMaterial({
                color: color,
                flatShading: true,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.5
            })
            const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)

            itemMesh.position.set(
                point.x + item.width / 2,
                item.height / 2,
                point.z
            )

            this.items = this.items.concat(itemMesh)
            this.itemMap.set(item.id, itemMesh)
            this.scene.add(itemMesh)

            point.x += item.width + delta
        }
    }

    addItemsToBox(boxMesh, items, boxData) {
        for (const item of items) {
            const color = colorFromUuid(item.id)
            const itemGeometry = new BoxGeometry(item.width, item.height, item.depth)
            const itemMaterial = new THREE.MeshPhongMaterial({
                color: color,
                flatShading: true,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.9
            })
            const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)

            // In boxpacker3, item.position is the bottom-left-front corner (pivot point)
            // In Three.js, mesh position is the center of the geometry
            // BoxGeometry center is at (0,0,0) in local coordinates
            // So we need to convert from pivot point to center point
            itemMesh.position.set(
                item.position.x + item.width / 2 - boxData.width / 2,
                item.position.y + item.height / 2 - boxData.height / 2,
                item.position.z + item.depth / 2 - boxData.depth / 2,
            )

            this.items = this.items.concat(itemMesh)
            this.itemMap.set(item.id, itemMesh)
            boxMesh.add(itemMesh)
            boxMesh.userData.items.push(item)
        }
    }

    animateItemsIntoBox(boxMesh, items, boxData) {
        let delay = 0
        const itemDelay = 100 / this.animationSpeed

        for (const item of items) {
            setTimeout(() => {
                const color = colorFromUuid(item.id)
                const itemGeometry = new BoxGeometry(item.width, item.height, item.depth)
                const itemMaterial = new THREE.MeshPhongMaterial({
                    color: color,
                    flatShading: true,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.9
                })
                const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)

                // Start position (above the box)
                const startY = boxData.height + item.height / 2 + 100
                // In boxpacker3, item.position is the bottom-left-front corner (pivot point)
                // In Three.js, mesh position is the center of the geometry
                // BoxGeometry center is at (0,0,0) in local coordinates
                const finalX = item.position.x + item.width / 2 - boxData.width / 2
                const finalY = item.position.y + item.height / 2 - boxData.height / 2
                const finalZ = item.position.z + item.depth / 2 - boxData.depth / 2

                itemMesh.position.set(finalX, startY, finalZ)
                itemMesh.scale.set(0.1, 0.1, 0.1)

                this.items = this.items.concat(itemMesh)
                this.itemMap.set(item.id, itemMesh)
                boxMesh.add(itemMesh)
                boxMesh.userData.items.push(item)

                // Animate
                const startTime = Date.now()
                const duration = 800 / this.animationSpeed
                const animate = () => {
                    const elapsed = Date.now() - startTime
                    const progress = Math.min(elapsed / duration, 1)
                    const easeProgress = 1 - Math.pow(1 - progress, 3) // Ease out cubic

                    itemMesh.position.y = startY + (finalY - startY) * easeProgress
                    itemMesh.scale.set(
                        0.1 + (1 - 0.1) * easeProgress,
                        0.1 + (1 - 0.1) * easeProgress,
                        0.1 + (1 - 0.1) * easeProgress
                    )

                    if (progress < 1) {
                        requestAnimationFrame(animate)
                    }
                }
                animate()
            }, delay)

            delay += itemDelay
        }
    }
}
