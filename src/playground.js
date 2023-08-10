import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";
import {BoxGeometry} from "three/src/geometries/BoxGeometry.js";
import { colorFromUuid } from "uuid-color";

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

    materials = {};

    constructor(container) {
        this.camera = new THREE.PerspectiveCamera(45, container.offsetWidth / window.innerHeight, 1, 80000);
        this.camera.position.set(-600, 550, 1300);

        this.ambientLight = new THREE.AmbientLight(0x7c7c7c, 3.0);

        this.light = new THREE.DirectionalLight(0xFFFFFF, 3.0);
        this.light.position.set(0.32, 0.39, 0.7);

        const canvasWidth = container.offsetWidth;
        const canvasHeight = window.innerHeight;

        this.renderer = new THREE.WebGLRenderer({antialias: true});
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(canvasWidth, canvasHeight);

        container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', (e) => this.onWindowResize(e, container));
        window.addEventListener('keydown', (e) => this.onKeyboard(e))

        this.cameraControls = new OrbitControls(this.camera, this.renderer.domElement);
        this.cameraControls.addEventListener('change', () => this.renderer.render(this.scene, this.camera));

        this.materials['wireframe'] = new THREE.MeshBasicMaterial({wireframe: true});
        this.materials['flat'] = new THREE.MeshPhongMaterial({
            specular: 0x000000,
            flatShading: true,
            side: THREE.DoubleSide
        });
        this.materials['smooth'] = new THREE.MeshLambertMaterial({side: THREE.DoubleSide});
        this.materials['glossy'] = new THREE.MeshPhongMaterial({side: THREE.DoubleSide});

        this.scene = new THREE.Scene();
        this.scene.background = null;

        this.scene.add(this.ambientLight);
        this.scene.add(this.light);
    }

    render(request) {
        if (
            request !== undefined
            && typeof request.boxes !== 'undefined'
            && request.boxes.length > 0
        ) {
            this.createObjects(request);
        }

        this.renderer.render(this.scene, this.camera);
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
        const delta = 200;
        switch (e.code) {
            case "KeyA":
            case "ArrowLeft":
                this.camera.position.set(this.camera.position.x - delta, this.camera.position.y, this.camera.position.z)
                break;
            case "KeyW":
            case "ArrowUp":
                this.camera.position.set(this.camera.position.x, this.camera.position.y, this.camera.position.z - delta)
                break;
            case "KeyD":
            case "ArrowRight":
                this.camera.position.set(this.camera.position.x + delta, this.camera.position.y, this.camera.position.z)
                break;
            case "KeyS":
            case "ArrowDown":
                this.camera.position.set(this.camera.position.x, this.camera.position.y, this.camera.position.z + delta)
                break;
        }

        this.cameraControls.update()
    }

    destroy() {
        for (const item of this.items) {
            item.geometry.dispose()
            this.scene.remove(item)
        }

        for (const box of this.boxes) {
            box.geometry.dispose()
            this.scene.remove(box)
        }

        this.boxes = []
        this.items = []
    }

    createObjects(request) {
        this.destroy()

        const delta = 50

        let point = {x: 0, y: 0, z: 0}
        let zMax = 0

        // boxes
        for (const box of request.boxes) {
            const boxGeometry = new BoxGeometry(box.width, box.height, box.depth)
            const boxMesh = new THREE.Mesh(boxGeometry, this.materials['wireframe'])

            point.x += box.width
            boxMesh.position.set(point.x, point.y, point.z)

            this.boxes = this.boxes.concat(boxMesh)
            this.scene.add(boxMesh);

            for (const item of box.items) {
                const color = colorFromUuid(item.id)
                const itemGeometry = new BoxGeometry(item.width, item.height, item.depth)
                const itemMesh = new THREE.Mesh(
                    itemGeometry,
                    new THREE.MeshPhongMaterial({
                        color: color,
                        flatShading: true,
                        side: THREE.DoubleSide
                    })
                )

                itemMesh.position.set(
                    item.position.x - box.width / 2 + item.width / 2,
                    item.position.y - box.height / 2 + item.height / 2,
                    item.position.z - box.depth / 2 + item.depth / 2,
                )

                this.items = this.items.concat(itemMesh)
                boxMesh.add(itemMesh)
            }

            point.x += delta
            zMax = Math.max(box.depth, zMax)
        }

        point = {x: 0, y: 0, z: zMax + delta}

        for (const item of request.items) {
            const color = colorFromUuid(item.id)
            const itemGeometry = new BoxGeometry(item.width, item.height, item.depth)
            const itemMesh = new THREE.Mesh(
                itemGeometry,
                new THREE.MeshPhongMaterial({
                    color: color,
                    flatShading: true,
                    side: THREE.DoubleSide
                })
            )

            console.log('unfit item', item, point)

            itemMesh.position.set(point.x, point.y, point.z)
            point.z += item.width + delta

            this.items = this.items.concat(itemMesh)

            this.scene.add(itemMesh)
        }
    }
}
