import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {BoxGeometry} from "three/src/geometries/BoxGeometry.js";
const ITEM_PALETTE = [
    0x5dffae,
    0x58b7ff,
    0xc291ff,
    0xff6b6b,
    0xd6ea64,
    0xff9946,
    0x4de1c1,
    0xf178b6,
    0x8f9dff,
]

function hashOf(text) {
    let hash = 0
    for (let i = 0; i < text.length; i++) {
        hash = (hash * 31 + text.charCodeAt(i)) & 0xffffffff
    }
    return Math.abs(hash)
}

const assigned = new Map()
const overrides = new Map()

export function setColorOverrides(pairs) {
    overrides.clear()

    for (const [key, value] of pairs) {
        if (value) {
            overrides.set(key, value)
        }
    }
}

export function paletteCss() {
    return ITEM_PALETTE.map(value => '#' + value.toString(16).padStart(6, '0'))
}

export function colorKey(item) {
    return item.group || String(item.id || '').replace(/#\d+$/, '')
}

export function resetColors(keys) {
    assigned.clear()
    keys.forEach(key => {
        if (!assigned.has(key)) {
            assigned.set(key, ITEM_PALETTE[assigned.size % ITEM_PALETTE.length])
        }
    })
}

function baseColor(key) {
    if (!assigned.has(key)) {
        assigned.set(key, ITEM_PALETTE[(assigned.size + hashOf(key)) % ITEM_PALETTE.length])
    }

    return assigned.get(key)
}

const shadeSteps = [0, -0.11, 0.1, -0.055, 0.16, -0.16, 0.05, -0.1, 0.13]

export function itemColor(item) {
    const key = colorKey(item)
    const chosen = overrides.get(key)
    const base = chosen === undefined ? baseColor(key) : Number.parseInt(chosen.replace('#', ''), 16)
    const copy = /#(\d+)$/.exec(String(item.id || ''))

    if (!copy) {
        return base
    }

    const shade = shadeSteps[(Number(copy[1]) - 1) % shadeSteps.length]
    const hsl = {}
    const color = new THREE.Color(base)
    color.getHSL(hsl)
    color.setHSL(
        (hsl.h + shade * 0.16 + 1) % 1,
        Math.min(1, Math.max(0.25, hsl.s + shade * 0.35)),
        Math.min(0.82, Math.max(0.32, hsl.l + shade)))

    return color.getHex()
}

export function itemColorCss(item) {
    return '#' + itemColor(item).toString(16).padStart(6, '0')
}

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

        const easedProgress = progress < 0.5
            ? 4 * progress * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        this.camera.position.x = this.startPosition.x + (this.targetPosition.x - this.startPosition.x) * easedProgress;
        this.camera.position.y = this.startPosition.y + (this.targetPosition.y - this.startPosition.y) * easedProgress;
        this.camera.position.z = this.startPosition.z + (this.targetPosition.z - this.startPosition.z) * easedProgress;

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

    boxes = [];

    items = [];

    boxMap = new Map();

    itemMap = new Map();

    materials = {};
    animationFrameId = null;
    selectedBox = null;
    selectedItem = null;
    onBoxSelect = null;
    onBoxDeselect = null;
    onItemDeselect = null;
    animationSpeed = 1;
    showAnimation = true;
    cameraAnimation = null;
    boxList = [];
    overlay = null;
    itemColors = new Map();
    pendingAnimations = [];
    ground = null;
    mouseDownPos = null;
    isDragging = false;

    constructor(container) {
        if (container) {
            this.attach(container)
        }
    }

    attach(container) {
        this.camera = new THREE.PerspectiveCamera(45, container.offsetWidth / container.offsetHeight, 1, 80000);
        this.camera.position.set(-600, 550, 1300);

        this.ambientLight = new THREE.HemisphereLight(0xc8d6d2, 0x0e1012, 1.5);

        this.light = new THREE.DirectionalLight(0xfff1dc, 2.2);
        this.light.position.set(0.6, 1.0, 0.45);

        this.fillLight = new THREE.DirectionalLight(0x9fb4c9, 0.85);
        this.fillLight.position.set(-0.7, 0.35, -0.5);

        this.rimLight = new THREE.DirectionalLight(0xffffff, 0.55);
        this.rimLight.position.set(-0.2, 0.6, -1.0);

        const canvasWidth = container.offsetWidth;
        const canvasHeight = container.offsetHeight;

        this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(canvasWidth, canvasHeight);

        container.appendChild(this.renderer.domElement);
        this.createOverlay(container);

        window.addEventListener('resize', (e) => this.onWindowResize(e, container));
        window.addEventListener('keydown', (e) => this.onKeyboard(e));

        this.cameraControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.cameraControls.enableDamping = true;
        this.cameraControls.dampingFactor = 0.09;
        this.cameraControls.rotateSpeed = 0.55;
        this.cameraControls.zoomSpeed = 0.7;
        this.cameraControls.panSpeed = 0.8;
        this.cameraControls.screenSpacePanning = true;
        this.cameraControls.maxPolarAngle = Math.PI * 0.495;
        this.cameraControls.mouseButtons = {
            LEFT: THREE.MOUSE.ROTATE,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
        };
        this.cameraControls.touches = {
            ONE: THREE.TOUCH.ROTATE,
            TWO: THREE.TOUCH.DOLLY_PAN,
        };
        this.cameraControls.addEventListener('change', () => this.renderer.render(this.scene, this.camera));

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        const canvas = this.renderer.domElement;

        canvas.style.cursor = 'grab';
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        canvas.addEventListener('mousedown', (e) => {
            this.mouseDownPos = { x: e.clientX, y: e.clientY };
            this.isDragging = false;
            canvas.style.cursor = 'grabbing';
        });

        canvas.addEventListener('mousemove', (e) => {
            if (this.mouseDownPos) {
                const dx = Math.abs(e.clientX - this.mouseDownPos.x);
                const dy = Math.abs(e.clientY - this.mouseDownPos.y);
                if (dx > 4 || dy > 4) {
                    this.isDragging = true;
                }
            }
        });

        canvas.addEventListener('mouseup', () => {
            this.mouseDownPos = null;
            canvas.style.cursor = 'grab';
        });

        canvas.addEventListener('dblclick', (e) => {
            const hit = this.pick(e);
            if (hit && hit.itemId) {
                this.selectItem(hit.itemId, true);
            } else if (hit && hit.boxId) {
                this.selectBox(hit.boxId, true);
            } else {
                this.viewFrom('fit');
            }
        });

        canvas.addEventListener('click', (e) => {
            if (!this.isDragging) {
                this.onCanvasClick(e);
            }
            this.isDragging = false;
        });

        this.materials['wireframe'] = new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0,
            depthWrite: false
        });
        this.materials['edges'] = new THREE.LineBasicMaterial({
            color: 0x4a5457,
            transparent: true,
            opacity: 0.75
        });
        this.materials['edges_unused'] = new THREE.LineBasicMaterial({
            color: 0x6c7a7d,
            transparent: true,
            opacity: 0.22
        });
        this.materials['edges_selected'] = new THREE.LineBasicMaterial({
            color: 0xffb74d
        });
        this.materials['box_floor'] = new THREE.MeshBasicMaterial({
            color: 0xffb74d,
            transparent: true,
            opacity: 0.05,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        this.materials['item_outline'] = new THREE.LineBasicMaterial({
            color: 0x030506,
            transparent: true,
            opacity: 0.55
        });
        this.materials['unfit_outline'] = new THREE.LineBasicMaterial({
            color: 0xff5252,
            transparent: true,
            opacity: 0.8
        });
        this.materials['item_selected'] = new THREE.MeshStandardMaterial({
            color: 0xffb74d,
            roughness: 0.3,
            metalness: 0.0,
            emissive: 0xff9946,
            emissiveIntensity: 0.45
        });

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.scene.add(this.ambientLight);
        this.scene.add(this.light);
        this.scene.add(this.fillLight);
        this.scene.add(this.rimLight);

        this.animate();
    }

    setFlat(flat) {
        this.flat = flat
    }

    setEmpty(empty) {
        if (this.emptyNote) {
            this.emptyNote.style.display = empty ? 'flex' : 'none'
        }
    }

    createOverlay(container) {
        this.emptyNote = document.createElement('div')
        this.emptyNote.className = 'scene-empty'
        this.emptyNote.innerHTML = '<span class="scene-empty-title">Nothing packed yet</span>' +
            '<span class="scene-empty-hint">Add items on the left and the packing appears here.</span>'
        this.emptyNote.style.display = 'none'
        container.appendChild(this.emptyNote)

        const overlay = document.createElement('div')
        overlay.className = 'hud'

        overlay.innerHTML = `
            <div class="hud-views">
                <button type="button" data-view="fit">fit</button>
                <button type="button" data-view="iso">iso</button>
                <button type="button" data-view="top">top</button>
                <button type="button" data-view="front">front</button>
                <button type="button" data-view="side">side</button>
            </div>
            <div class="hud-hint">
                left-drag orbit · right-drag pan · wheel zoom · click select · double-click focus · esc clear
            </div>
        `

        overlay.querySelectorAll('[data-view]').forEach(button => {
            button.addEventListener('click', () => this.viewFrom(button.dataset.view))
        })

        container.appendChild(overlay)
        this.overlay = overlay
    }

    setSummary(summary) {
        if (!this.overlay) {
            return
        }

        for (const [key, value] of Object.entries(summary)) {
            const node = this.overlay.querySelector(`[data-hud="${key}"]`)
            if (node) {
                node.textContent = value
            }
        }
    }

    viewFrom(preset) {
        const bounds = new THREE.Box3()

        for (const mesh of this.boxes) bounds.expandByObject(mesh)
        for (const mesh of this.items) bounds.expandByObject(mesh)

        if (bounds.isEmpty()) {
            return
        }

        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z) * 0.5
        const distance = (radius / Math.sin((this.camera.fov * Math.PI / 180) / 2)) * 1.35

        const directions = {
            fit: new THREE.Vector3(-0.55, 0.5, 1),
            iso: new THREE.Vector3(-0.8, 0.65, 0.8),
            top: new THREE.Vector3(0, 1, 0.001),
            front: new THREE.Vector3(0, 0.12, 1),
            side: new THREE.Vector3(1, 0.12, 0.001),
        }

        const direction = (directions[preset] || directions.fit).clone().normalize()
        const target = center.clone().add(direction.multiplyScalar(distance))

        this.cameraAnimation = new CameraAnimation(
            this.camera, this.cameraControls, target, center, 700)
    }

    animate() {
        this.animationFrameId = requestAnimationFrame(() => this.animate());

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
            this.fitToScene();
        }
    }

    selectBox(boxId, animate = true) {
        if (this.selectedBox) {
            const oldBox = this.boxMap.get(this.selectedBox);
            if (oldBox) {
                if (oldBox.userData.edges) oldBox.userData.edges.material = this.materials['edges'];
            }
        }

        if (this.selectedItem) {
            const oldItem = this.itemMap.get(this.selectedItem);
            if (oldItem) {
                const color = this.itemColors.get(this.selectedItem) ?? 0x8b9791;
                oldItem.material = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.55,
                    metalness: 0.05,
                    emissive: color,
                    emissiveIntensity: 0.12,
                    transparent: true,
                    opacity: 0.9
                });
            }
            this.selectedItem = null;
        }

        this.selectedBox = boxId;
        const box = this.boxMap.get(boxId);
        if (box) {
            if (box.userData.edges) box.userData.edges.material = this.materials['edges_selected'];

            const boxPosition = box.position.clone();
            const boxData = box.userData.boxData;
            const boxSize = Math.max(boxData.width, boxData.height, boxData.depth);

            const diagonal = Math.sqrt(
                boxData.width * boxData.width +
                boxData.height * boxData.height +
                boxData.depth * boxData.depth
            );
            const distance = diagonal * 1.5;

            const angle = Math.PI / 4;
            const height = boxData.depth * 0.7;

            const targetPosition = new THREE.Vector3(
                boxPosition.x + Math.cos(angle) * distance,
                boxPosition.y + height,
                boxPosition.z + Math.sin(angle) * distance
            );

            const targetLookAt = new THREE.Vector3(
                boxPosition.x,
                boxPosition.y + boxData.depth * 0.3,
                boxPosition.z
            );

            if (animate && this.cameraAnimation) {
                this.cameraAnimation.stop();
            }

            if (animate) {
                this.cameraAnimation = new CameraAnimation(
                    this.camera,
                    this.cameraControls,
                    targetPosition,
                    targetLookAt,
                    1000
                );
            } else {
                this.camera.position.copy(targetPosition);
                this.cameraControls.target.copy(targetLookAt);
                this.cameraControls.update();
            }
        }

        if (this.onBoxSelect) {
            this.onBoxSelect(boxId);
        }
    }

    selectItem(itemId, animate = true) {
        if (this.selectedItem) {
            const oldItem = this.itemMap.get(this.selectedItem);
            if (oldItem) {
                const color = this.itemColors.get(this.selectedItem) ?? 0x8b9791;
                oldItem.material = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.55,
                    metalness: 0.05,
                    emissive: color,
                    emissiveIntensity: 0.12,
                    transparent: true,
                    opacity: 0.9
                });
            }
        }

        this.selectedItem = itemId;
        const item = this.itemMap.get(itemId);
        if (item) {
            item.material = this.materials['item_selected'];

            if (this.onItemSelect) {
                this.onItemSelect(itemId, item.parent?.userData?.boxId);
            }

            if (animate) {
                const itemPosition = new THREE.Vector3();
                item.getWorldPosition(itemPosition);

                const itemData = item.userData?.itemData;
                if (itemData) {
                    const diagonal = Math.sqrt(
                        itemData.width * itemData.width +
                        itemData.height * itemData.height +
                        itemData.depth * itemData.depth
                    );

                    const boxData = item.parent?.userData?.boxData;
                    const around = boxData
                        ? Math.sqrt(
                            boxData.width * boxData.width +
                            boxData.height * boxData.height +
                            boxData.depth * boxData.depth)
                        : diagonal * 4;
                    const distance = Math.max(diagonal * 3, around * 0.85);

                    const angle = Math.PI / 4;
                    const height = Math.max(itemData.depth, distance * 0.35);

                    const targetPosition = new THREE.Vector3(
                        itemPosition.x + Math.cos(angle) * distance,
                        itemPosition.y + height,
                        itemPosition.z + Math.sin(angle) * distance
                    );

                    const targetLookAt = itemPosition.clone();

                    if (this.cameraAnimation) {
                        this.cameraAnimation.stop();
                    }

                    this.cameraAnimation = new CameraAnimation(
                        this.camera,
                        this.cameraControls,
                        targetPosition,
                        targetLookAt,
                        800
                    );
                }
            }
        }
    }

    deselectItem() {
        if (this.selectedItem) {
            const oldItem = this.itemMap.get(this.selectedItem);
            if (oldItem) {
                const color = this.itemColors.get(this.selectedItem) ?? 0x8b9791;
                oldItem.material = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.55,
                    metalness: 0.05,
                    emissive: color,
                    emissiveIntensity: 0.12,
                    transparent: true,
                    opacity: 0.9
                });
            }
            this.selectedItem = null;

            if (this.onItemDeselect) {
                this.onItemDeselect();
            }
        }
    }

    deselectBox() {
        if (this.selectedBox) {
            const oldBox = this.boxMap.get(this.selectedBox);
            if (oldBox) {
                if (oldBox.userData.edges) oldBox.userData.edges.material = this.materials['edges'];
            }
            this.selectedBox = null;

            this.deselectItem();

            if (this.onBoxDeselect) {
                this.onBoxDeselect();
            }
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
        const canvasWidth = container.clientWidth;
        const canvasHeight = container.clientHeight;

        if (canvasWidth === 0 || canvasHeight === 0) {
            return;
        }

        this.renderer.setSize(canvasWidth, canvasHeight);

        this.camera.aspect = canvasWidth / canvasHeight;
        this.camera.updateProjectionMatrix();

        this.renderer.render(this.scene, this.camera)
    }

    onKeyboard(e) {
        const target = e.target
        if (target && (target.isContentEditable ||
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) {
            return
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            if (this.selectedItem) {
                this.deselectItem();
                return;
            } else if (this.selectedBox) {
                this.deselectBox();
                return;
            }
        }

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

    pick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        const hits = this.raycaster.intersectObjects([...this.items, ...this.boxes], true);

        let fallback = null;

        for (const hit of hits) {
            let node = hit.object;

            while (node) {
                const itemId = node.userData?.itemData?.id;

                if (itemId !== undefined && this.itemMap.has(itemId)) {
                    return { itemId, boxId: node.parent?.userData?.boxId };
                }

                if (fallback === null && this.boxMap.has(node.userData?.boxId)) {
                    fallback = node.userData.boxId;
                }

                node = node.parent;
            }
        }

        return fallback === null ? null : { boxId: fallback };
    }

    onCanvasClick(event) {
        const hit = this.pick(event);

        if (!hit) {
            return;
        }

        if (hit.itemId) {
            this.selectItem(hit.itemId, false);
            return;
        }

        this.selectBox(hit.boxId, false);
    }

    release(root) {
        const shared = new Set(Object.values(this.materials))

        root.traverse(node => {
            if (node.geometry) {
                node.geometry.dispose()
            }

            for (const material of [].concat(node.material || [])) {
                if (!shared.has(material)) {
                    material.dispose()
                }
            }
        })
    }

    destroy() {
        for (const timer of this.pendingAnimations) {
            clearTimeout(timer)
        }

        this.pendingAnimations = []

        if (this.ground) {
            this.scene.remove(this.ground)
            this.ground.geometry.dispose()
            this.ground.material.dispose()
            this.ground = null
        }

        for (const mesh of this.items.concat(this.boxes)) {
            this.release(mesh)
            this.scene.remove(mesh)
        }

        this.boxes = []
        this.items = []
        this.boxMap.clear()
        this.itemMap.clear()
        this.itemColors.clear()
        this.selectedBox = null
        this.selectedItem = null
    }

    createObjects(request) {
        this.destroy()

        const filled = request.boxes.filter(box => box.items && box.items.length > 0)
        const drawn = this.showUnusedBoxes ? request.boxes : filled

        this.setEmpty(drawn.length === 0)

        if (drawn.length === 0) {
            this.renderer.render(this.scene, this.camera)

            return
        }

        const ordered = drawn.slice().sort((a, b) => {
            const filledA = a.items && a.items.length > 0 ? 0 : 1
            const filledB = b.items && b.items.length > 0 ? 0 : 1

            return filledA - filledB || b.width * b.height - a.width * a.height
        })

        this.addGround({ boxes: ordered })

        this.boxList = ordered.map(box => box.id);

        const delta = Math.max(50, ordered.reduce(
            (largest, box) => Math.max(largest, box.width, box.height), 0) * 0.12)

        const spanBudget = Math.max(
            ordered.reduce((total, box) => total + box.width + delta, 0) ** 0.5
                * Math.max(...ordered.map(box => box.width)) ** 0.5,
            Math.max(...ordered.map(box => box.width)))

        let cursorX = 0
        let rowFront = 0
        let rowDepth = 0
        let layoutDepth = 0

        for (const box of ordered) {
            if (cursorX > 0 && cursorX + box.width > spanBudget) {
                rowFront += rowDepth + delta
                rowDepth = 0
                cursorX = 0
            }

            const boxGeometry = new BoxGeometry(box.width, box.depth, box.height)
            const boxMesh = new THREE.Mesh(boxGeometry, this.materials['wireframe'])

            const empty = !box.items || box.items.length === 0

            const edges = new THREE.LineSegments(
                new THREE.EdgesGeometry(boxGeometry),
                this.materials[empty ? 'edges_unused' : 'edges'])
            boxMesh.add(edges)

            if (!empty) {
                const floor = new THREE.Mesh(
                    new THREE.PlaneGeometry(box.width, box.height),
                    this.materials['box_floor'])
                floor.rotation.x = -Math.PI / 2
                floor.position.y = -box.depth / 2 + 0.5
                boxMesh.add(floor)
            }

            boxMesh.position.set(cursorX + box.width / 2, box.depth / 2, rowFront + box.height / 2)

            this.boxes = this.boxes.concat(boxMesh)
            this.boxMap.set(box.id, boxMesh)
            this.scene.add(boxMesh);

            boxMesh.userData = {
                boxId: box.id,
                boxData: box,
                items: [],
                edges
            }

            if (this.showAnimation) {
                this.animateItemsIntoBox(boxMesh, box.items, box);
            } else {
                this.addItemsToBox(boxMesh, box.items, box);
            }

            cursorX += box.width + delta
            rowDepth = Math.max(rowDepth, box.height)
            layoutDepth = Math.max(layoutDepth, rowFront + box.height)
        }

        const zMax = layoutDepth
        let point = {x: 0, y: 0, z: 0}

        const deepest = ordered.reduce((largest, box) => Math.max(largest, box.height), 0)
        point = {x: 0, y: 0, z: zMax + delta + Math.max(300, deepest * 0.9)}

        for (const item of request.items || []) {
            const color = itemColor(item)
            const itemGeometry = new BoxGeometry(item.width, item.depth, item.height)
            const itemMaterial = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.55,
                metalness: 0.05,
                emissive: color,
                emissiveIntensity: 0.12,
                transparent: true,
                opacity: 0.35
            })
            const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)
            itemMesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(itemGeometry), this.materials['unfit_outline']))
            this.itemColors.set(item.id, color)

            itemMesh.position.set(
                point.x + item.width / 2,
                item.depth / 2,
                point.z
            )

            this.items = this.items.concat(itemMesh)
            this.itemMap.set(item.id, itemMesh)
            this.scene.add(itemMesh)

            point.x += item.width + delta
        }
    }

    addGround(request) {
        const span = (request.boxes || []).reduce(
            (total, box) => total + box.width + 50, 0) || 1000
        const size = Math.max(span, 1000) * 1.6
        const divisions = Math.max(8, Math.round(size / 250))

        this.ground = new THREE.GridHelper(size, divisions, 0x6c7a7d, 0x333c3f)
        this.ground.position.set(span / 2, -0.5, 0)
        this.ground.material.transparent = true
        this.ground.material.opacity = 0.9
        this.scene.add(this.ground)
    }

    fitToScene() {
        let bounds = new THREE.Box3()
        const everything = new THREE.Box3()

        for (const mesh of this.boxes) {
            const data = mesh.userData.boxData

            everything.expandByObject(mesh)

            if (data && data.items && data.items.length > 0) {
                bounds.expandByObject(mesh)
            }
        }

        for (const mesh of this.items) {
            bounds.expandByObject(mesh)
            everything.expandByObject(mesh)
        }

        if (bounds.isEmpty()) {
            bounds = everything
        }

        if (bounds.isEmpty()) {
            return
        }

        if (this.showUnusedBoxes && bounds !== everything) {
            const span = box => Math.max(...box.getSize(new THREE.Vector3()).toArray())
            const packed = span(bounds)

            bounds = span(everything) <= packed * 2.5
                ? everything
                : bounds.clone().expandByScalar(packed * 0.45)
        }

        const size = bounds.getSize(new THREE.Vector3())
        const center = bounds.getCenter(new THREE.Vector3())
        const radius = Math.max(size.x, size.y, size.z) * 0.5
        const fov = this.camera.fov * (Math.PI / 180)
        const distance = (radius / Math.sin(fov / 2)) * 1.35

        this.camera.near = Math.max(distance / 1000, 0.1)
        this.camera.far = distance * 12
        this.camera.updateProjectionMatrix()

        this.cameraControls.maxPolarAngle = this.flat ? Math.PI * 0.98 : Math.PI * 0.495

        const direction = this.flat
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(-0.55, 0.5, 1).normalize()
        this.camera.position.copy(center.clone().add(direction.multiplyScalar(distance)))

        this.cameraControls.target.copy(center)
        this.cameraControls.minDistance = radius * 0.25
        this.cameraControls.maxDistance = distance * 6
        this.cameraControls.update()
    }

    addItemsToBox(boxMesh, items, boxData) {
        for (const item of items) {
            const color = itemColor(item)
            const itemGeometry = new BoxGeometry(item.width, item.depth, item.height)
            const itemMaterial = new THREE.MeshStandardMaterial({
                color: color,
                roughness: 0.55,
                metalness: 0.05,
                emissive: color,
                emissiveIntensity: 0.12,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.9
            })
            const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)
            itemMesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(itemGeometry), this.materials['item_outline']))
            this.itemColors.set(item.id, color)

            itemMesh.position.set(
                item.position.x + item.width / 2 - boxData.width / 2,
                item.position.z + item.depth / 2 - boxData.depth / 2,
                item.position.y + item.height / 2 - boxData.height / 2,
            )

            itemMesh.userData.itemData = item;

            this.items = this.items.concat(itemMesh)
            this.itemMap.set(item.id, itemMesh)
            boxMesh.add(itemMesh)
            boxMesh.userData.items.push(item)
        }
    }

    animateItemsIntoBox(boxMesh, items, boxData) {
        let delay = 0
        const itemDelay = Math.min(60, 900 / Math.max(items.length, 1)) / this.animationSpeed

        for (const item of items) {
            this.pendingAnimations.push(setTimeout(() => {
                const color = itemColor(item)
                const itemGeometry = new BoxGeometry(item.width, item.depth, item.height)
                const itemMaterial = new THREE.MeshStandardMaterial({
                    color: color,
                    roughness: 0.55,
                    metalness: 0.05,
                    emissive: color,
                    emissiveIntensity: 0.12,
                    side: THREE.DoubleSide,
                    transparent: true,
                    opacity: 0.9
                })
                const itemMesh = new THREE.Mesh(itemGeometry, itemMaterial)
            itemMesh.add(new THREE.LineSegments(
                new THREE.EdgesGeometry(itemGeometry), this.materials['item_outline']))
            this.itemColors.set(item.id, color)

                const startY = boxData.depth + item.depth / 2 + 100
                const finalX = item.position.x + item.width / 2 - boxData.width / 2
                const finalY = item.position.z + item.depth / 2 - boxData.depth / 2
                const finalZ = item.position.y + item.height / 2 - boxData.height / 2

                itemMesh.position.set(finalX, startY, finalZ)
                itemMesh.scale.set(0.1, 0.1, 0.1)

                itemMesh.userData.itemData = item;

                this.items = this.items.concat(itemMesh)
                this.itemMap.set(item.id, itemMesh)
                boxMesh.add(itemMesh)
                boxMesh.userData.items.push(item)

                const startTime = Date.now()
                const duration = 420 / this.animationSpeed
                const animate = () => {
                    const elapsed = Date.now() - startTime
                    const progress = Math.min(elapsed / duration, 1)
                    const easeProgress = 1 - Math.pow(1 - progress, 3)

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
            }, delay))

            delay += itemDelay
        }
    }
}
