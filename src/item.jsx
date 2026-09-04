import React from 'react';
import {generateUUID} from "three/src/math/MathUtils.js";
import api from './api.js'
import {itemColorCss, resetColors, setColorOverrides, paletteCss} from './playground.js'

const boxType = 0
const itemType = 1

const defaultSettings = {
    order: 'decreasing',
    selection: 'fullest-box',
    parallel: false,
    algorithms: ['FullestBoxDecreasing', 'FirstFitDecreasing', 'BestFitDecreasing'],
    goal: 'FewestBoxes',
    supportRatio: 0,
    auto: false,
    balanceWeight: true,
    search: false,
    searchFills: false,
    freeSpaceCorners: false,
    merit: 'contact-first',
    rehome: false,
    singleContainer: false,
}

const AUTO_PRESET = -2

const FLAT_DEPTH = 1

const EXPORT_HEADER = 'kind;width;height;depth;weight;qty;rotation;group;colour;enabled;tare;inner;top;class;apart'

function parseExported(line) {
    const owned = /^(box|item)([;,\t])/.exec(line)
    const parts = (owned ? line.split(owned[2]) : line.split(/[;,\t]/)).map(part => part.trim())
    const numbers = values => values.every(value => Number.isFinite(value) && value > 0)

    if (parts[0] === 'box' || parts[0] === 'item') {
        const [kind, width, height, depth, weight, qty, rotation, group, colour, enabled, tare, inner, top, klass, apart, takes] = parts
        const sides = (inner || '').split(/[x×*]/).map(Number)
        const lined = sides.length === 3 && sides.every(v => isFinite(v) && v > 0)
        const dims = [width, height, depth].map(Number)
        const mass = Number(weight)

        if (!numbers(dims) || !Number.isFinite(mass) || mass < 0) {
            return null
        }

        return {
            type: kind === 'box' ? boxType : itemType,
            width: dims[0], height: dims[1], depth: dims[2], weight: mass,
            quantity: Math.max(parseInt(qty, 10) || 1, 1),
            rotation: rotation || '',
            group: group || '',
            color: colour || '',
            enabled: enabled === undefined || enabled === '' || enabled === '1' || enabled === 'true',
            tare: Number(tare) || 0,
            innerWidth: lined ? sides[0] : 0,
            innerHeight: lined ? sides[1] : 0,
            innerDepth: lined ? sides[2] : 0,
            nothingOnTop: top === 'none',
            maxLoadOnTop: top === 'none' ? 0 : Math.max(Number(top) || 0, 0),
            class: klass || '',
            separateFrom: (apart || '').split(',').map(part => part.trim()).filter(Boolean),
            accepts: (takes || '').split(',').map(part => part.trim()).filter(Boolean),
        }
    }

    const legacy = parts.filter(Boolean)

    if (legacy.length < 4) {
        return null
    }

    const dims = legacy.slice(0, 3).map(Number)
    const mass = Number(legacy[3])

    if (!numbers(dims) || !Number.isFinite(mass) || mass < 0) {
        return null
    }

    return {
        type: Number(legacy[4]) === boxType ? boxType : itemType,
        width: dims[0], height: dims[1], depth: dims[2], weight: mass,
        quantity: 1, rotation: '', group: '', color: '', enabled: true,
        tare: 0, innerWidth: 0, innerHeight: 0, innerDepth: 0,
    }
}

function swatchOf(datum) {
    return datum.color || itemColorCss({ id: datum.id, group: datum.group })
}

function formatWeight(grams) {
    return grams >= 1000 ? `${(grams / 1000).toFixed(2)} kg` : `${Math.round(grams)} g`
}

function meterRow(label, percent, detail, kind = 'limit') {
    const level = kind === 'fill'
        ? ''
        : percent > 90 ? ' is-danger' : percent > 75 ? ' is-warn' : ''

    return (
        <div className="meter" title={detail}>
            <span className="meter-label">{label}</span>
            <span className="meter-track">
                <span className={`meter-fill${level}`} style={{ width: `${Math.min(percent, 100)}%` }} />
            </span>
            <span className="meter-value">{percent.toFixed(0)}%</span>
        </div>
    )
}

function flatPlaceholder(flat, type, boxKind) {
    if (type === boxKind) {
        return flat ? '1200;800;50000' : '400;300;200;20000'
    }

    return flat ? '297;210;40' : '120;90;70;500'
}

function flatDefaults(flat) {
    if (!flat) {
        return []
    }

    const sheets = [
        [1200, 800], [1000, 600], [600, 400], [400, 300],
    ].map(([w, h]) => new Datum(generateUUID(), boxType, w, h, FLAT_DEPTH, 50000, { quantity: 20 }))

    const cuts = [
        [420, 297, 4], [297, 210, 8], [210, 148, 6], [180, 120, 4],
    ].map(([w, h, qty]) => new Datum(generateUUID(), itemType, w, h, FLAT_DEPTH, 40, { quantity: qty }))

    return sheets.concat(cuts)
}

const AXIS_SIZE = { x: 'width', y: 'height', z: 'depth' }
const AXIS_AT = { x: 'x', y: 'y', z: 'z' }

function orthoView(box, items, plane, canvas, articles) {
    const across = box[AXIS_SIZE[plane.across]]
    const up = box[AXIS_SIZE[plane.up]]
    const scale = Math.min(canvas / across, (canvas * 0.66) / up)

    const pieces = items.map((item, index) => {
        const article = articleOf(articles, item)
        const w = Math.max(item[AXIS_SIZE[plane.across]] * scale, 1)
        const h = Math.max(item[AXIS_SIZE[plane.up]] * scale, 1)
        const at = item.position[AXIS_AT[plane.up]]

        return {
            key: `${plane.across}${plane.up}-${item.id}`,
            step: index + 1,
            x: item.position[AXIS_AT[plane.across]] * scale,
            y: plane.flip ? (up - at - item[AXIS_SIZE[plane.up]]) * scale : at * scale,
            w,
            h,
            fill: article.color,
            label: article.label,
            roomy: w > 26 && h > 18,
        }
    })

    return { width: across * scale, height: up * scale, scale, pieces }
}

function centreOfGravity(box) {
    let mass = 0
    let x = 0
    let y = 0
    let z = 0

    for (const item of box.items) {
        const w = item.weight || 0

        mass += w
        x += w * (item.position.x + item.width / 2)
        y += w * (item.position.y + item.height / 2)
        z += w * (item.position.z + item.depth / 2)
    }

    if (mass <= 0) {
        return null
    }

    const centre = { x: x / mass, y: y / mass, z: z / mass, mass }
    const share = axis => centre[axis] / box[{ x: 'width', y: 'height', z: 'depth' }[axis]]

    centre.balanced = ['x', 'y'].every(axis => share(axis) > 1 / 3 && share(axis) < 2 / 3)
    centre.shareX = share('x')
    centre.shareY = share('y')

    return centre
}

function cargoList(box, articles) {
    const rows = new Map()

    for (const item of box.items) {
        const article = articleOf(articles, item)
        const row = rows.get(article.label) || {
            label: article.label,
            dims: article.dims,
            group: article.group,
            color: article.color,
            unit: item.weight,
            count: 0,
            nothingOnTop: item.nothingOnTop || false,
            maxLoadOnTop: item.maxLoadOnTop || 0,
            class: item.class || '',
            separateFrom: item.separateFrom || [],
        }

        row.count += 1
        rows.set(article.label, row)
    }

    return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function cargoNote(row) {
    const notes = []

    if (row.nothingOnTop) {
        notes.push('nothing on top')
    } else if (row.maxLoadOnTop > 0) {
        notes.push(`carries ${formatWeight(row.maxLoadOnTop)}`)
    }

    if (row.separateFrom.length) {
        notes.push(`away from ${row.separateFrom.join(', ')}`)
    }

    if (row.group) {
        notes.push(`ships with ${row.group}`)
    }

    return notes.join(' · ')
}

function niceStep(span) {
    const raw = span / 6
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))))

    for (const multiple of [1, 2, 2.5, 5]) {
        if (raw <= multiple * power) {
            return multiple * power
        }
    }

    return 10 * power
}

function rulerTicks(span, scale) {
    const step = niceStep(span)
    const ticks = []

    for (let at = 0; at < span - step * 0.4; at += step) {
        ticks.push({ at: Math.round(at), pos: at * scale })
    }

    ticks.push({ at: Math.round(span), pos: span * scale })

    return ticks
}

const BADGE = 9

function compareOutcome(a, b) {
    return (a.unfit - b.unfit)
        || (Math.round(a.capacity) - Math.round(b.capacity))
        || (a.boxes - b.boxes)
        || (b.fill - a.fill)
}

function outcomeKey(row) {
    const shape = (row.containers || [])
        .map(box => `${box.width}x${box.height}x${box.depth}@${box.fill.toFixed(2)}`)
        .join(',')

    return `${row.unfit}|${shape}`
}

function outcomePreview(containers, canvas, tall) {
    const shown = containers.slice(0, 12)
    const gap = 4

    if (shown.length === 0) {
        return { width: canvas, height: tall, boxes: [] }
    }

    const widest = shown.reduce((total, box) => total + box.width, 0) + gap * (shown.length - 1)
    const deepest = Math.max(...shown.map(box => box.depth))
    const scale = Math.min(canvas / widest, tall / deepest)

    let cursor = 0
    const boxes = shown.map((box, index) => {
        const drawn = {
            key: index,
            x: cursor,
            width: Math.max(box.width * scale, 2),
            height: Math.max(box.depth * scale, 2),
            fill: box.fill,
            items: box.items,
        }

        cursor += box.width * scale + gap

        return drawn
    })

    return {
        width: cursor - gap,
        height: deepest * scale,
        boxes,
        hidden: containers.length - shown.length,
    }
}

function groupOutcomes(rows) {
    const groups = new Map()

    for (const row of rows) {
        if (row.failed) {
            continue
        }

        const key = outcomeKey(row)
        const group = groups.get(key) || {
            key,
            unfit: row.unfit,
            boxes: row.boxes,
            capacity: row.capacity,
            fill: row.fill,
            containers: row.containers || [],
            best: false,
            ways: [],
        }

        group.best = group.best || row.best
        group.ways.push(row)
        groups.set(key, group)
    }

    return [...groups.values()].sort(compareOutcome)
}

function labelOf(options, value) {
    return (options || []).find(o => o.value === value)?.label || value || ''
}

function ruleGist(meta, rule) {
    return (meta?.selections || []).find(o => o.value === rule)?.gist || ''
}

function ruleNote(meta, rule) {
    const found = (meta?.selections || []).find(o => o.value === rule)

    if (!found) {
        return rule
    }

    return [found.description, found.bound && `Worst case: ${found.bound}.`]
        .filter(Boolean).join(' ')
}

function formatVolume(cubicMillimetres) {
    if (cubicMillimetres >= 1e9) {
        return `${(cubicMillimetres / 1e9).toFixed(2)} m³`
    }

    return `${Math.round(cubicMillimetres / 1e6)} L`
}

const PANE_SLOTS = [0, 240, 330, 430, 560]
const STRIP_SLOTS = [0, 130, 200, 300, 440]
const SNAP = 16

function pieceBadges(pieces) {
    return pieces.map(piece => {
        const inside = piece.w >= BADGE * 2.4 && piece.h >= BADGE * 2.4

        return {
            ...piece,
            inside,
            bx: inside ? piece.x + piece.w / 2 : piece.x + piece.w + BADGE + 3,
            by: inside ? piece.y + piece.h / 2 : piece.y + piece.h / 2,
        }
    })
}

function planPieces(box, items, articles, scale) {
    return items.map((item, index) => {
        const article = articleOf(articles, item)

        return {
            key: item.id,
            step: index + 1,
            label: article.label,
            color: article.color,
            x: item.position.x * scale,
            y: (box.height - item.position.y - item.height) * scale,
            w: Math.max(item.width * scale, 1),
            h: Math.max(item.height * scale, 1),
        }
    })
}

function unfoldedNet(box, items, articles, canvas) {
    const scale = canvas / (box.width + box.depth * 2)
    const left = box.depth * scale
    const top = box.depth * scale
    const floorWidth = box.width * scale
    const floorHeight = box.height * scale
    const wall = box.depth * scale

    const piece = (item, x, y, w, h) => {
        const article = articleOf(articles, item)

        return {
            key: item.id,
            x, y,
            w: Math.max(w, 1),
            h: Math.max(h, 1),
            color: article.color,
            label: article.label,
        }
    }

    const againstBack = items.filter(item => item.position.y + item.height >= box.height - 0.5)
    const againstFront = items.filter(item => item.position.y <= 0.5)
    const againstLeft = items.filter(item => item.position.x <= 0.5)
    const againstRight = items.filter(item => item.position.x + item.width >= box.width - 0.5)
    const onFloor = items.filter(item => item.position.z <= 0.5)

    const panels = [
        {
            key: 'back',
            title: 'Back wall',
            labelX: left + floorWidth / 2, labelY: -8, anchor: 'middle',
            x: left, y: 0, w: floorWidth, h: wall,
            pieces: againstBack.map(item => piece(item,
                left + item.position.x * scale,
                top - (item.position.z + item.depth) * scale,
                item.width * scale, item.depth * scale)),
        },
        {
            key: 'left',
            title: 'Left wall',
            labelX: -8, labelY: top + floorHeight / 2, anchor: 'end',
            x: 0, y: top, w: wall, h: floorHeight,
            pieces: againstLeft.map(item => piece(item,
                left - (item.position.z + item.depth) * scale,
                top + (box.height - item.position.y - item.height) * scale,
                item.depth * scale, item.height * scale)),
        },
        {
            key: 'floor',
            title: 'Floor · bottom layer',
            labelX: left + 4, labelY: top + 12, anchor: 'start',
            x: left, y: top, w: floorWidth, h: floorHeight,
            pieces: onFloor.map(item => piece(item,
                left + item.position.x * scale,
                top + (box.height - item.position.y - item.height) * scale,
                item.width * scale, item.height * scale)),
        },
        {
            key: 'right',
            title: 'Right wall',
            labelX: left + floorWidth + wall + 8, labelY: top + floorHeight / 2, anchor: 'start',
            x: left + floorWidth, y: top, w: wall, h: floorHeight,
            pieces: againstRight.map(item => piece(item,
                left + floorWidth + item.position.z * scale,
                top + (box.height - item.position.y - item.height) * scale,
                item.depth * scale, item.height * scale)),
        },
        {
            key: 'front',
            title: 'Front wall — the side you open',
            labelX: left + floorWidth / 2, labelY: top + floorHeight + wall + 13, anchor: 'middle',
            x: left, y: top + floorHeight, w: floorWidth, h: wall,
            pieces: againstFront.map(item => piece(item,
                left + item.position.x * scale,
                top + floorHeight + item.position.z * scale,
                item.width * scale, item.depth * scale)),
        },
    ]

    return {
        scale,
        width: floorWidth + wall * 2,
        height: floorHeight + wall * 2,
        panels,
    }
}

function elevationFloors(box, layers, plane, view) {
    const up = box[AXIS_SIZE[plane.up]]

    return layers.map((layer, index) => ({
        key: layer.floor,
        index: index + 1,
        y: (up - layer.floor) * view.scale,
        label: `${layer.floor}`,
    }))
}

function layerOf(box, item) {
    const floors = [...new Set(box.items.map(other => Math.round(other.position.z)))]
        .sort((a, b) => a - b)

    return {
        index: floors.indexOf(Math.round(item.position.z)) + 1,
        total: floors.length,
    }
}

function coveredBy(box, item) {
    const top = item.position.z + item.depth

    return box.items.filter(other => other !== item
        && Math.abs(other.position.z - top) < 0.5
        && other.position.x < item.position.x + item.width - 0.5
        && item.position.x < other.position.x + other.width - 0.5
        && other.position.y < item.position.y + item.height - 0.5
        && item.position.y < other.position.y + other.height - 0.5)
}

function loadOn(box, item) {
    const top = item.position.z + item.depth

    return box.items.filter(other => other !== item
        && other.position.z + 0.5 >= top
        && other.position.x < item.position.x + item.width - 0.5
        && item.position.x < other.position.x + other.width - 0.5
        && other.position.y < item.position.y + item.height - 0.5
        && item.position.y < other.position.y + other.height - 0.5)
        .reduce((total, other) => total + other.weight, 0)
}

const SPREADING_RULES = ['worst-fit', 'almost-worst-fit']

function boxSizesOffered(elements) {
    const sizes = new Set()

    for (const element of elements) {
        if (element.enabled && element.type === boxType) {
            sizes.add(`${element.width}x${element.height}x${element.depth}`)
        }
    }

    return sizes.size
}

function orderSummary(elements, packResult) {
    const active = elements.filter(element => element.enabled)
    const goods = active.filter(element => element.type === itemType)
    const crates = active.filter(element => element.type === boxType)
    const pieces = goods.reduce((sum, element) => sum + Math.max(element.quantity || 1, 1), 0)
    const weight = goods.reduce((sum, element) =>
        sum + element.weight * Math.max(element.quantity || 1, 1), 0)
    const volume = goods.reduce((sum, element) =>
        sum + element.width * element.height * element.depth * Math.max(element.quantity || 1, 1), 0)

    const used = (packResult?.boxes || []).filter(box => box.items.length > 0)
    const capacity = used.reduce((sum, box) => sum + (box.volumeAvailable || 0), 0)
    const filled = used.reduce((sum, box) => sum + (box.volumeUsed || 0), 0)

    const classes = [...new Set(goods.map(element => element.class).filter(Boolean))]
    const keptApart = goods.filter(element => element.separateFrom.length > 0).length
    const loadLimited = goods.filter(element =>
        element.nothingOnTop || element.maxLoadOnTop > 0).length
    const dedicated = crates.filter(element => element.accepts.length > 0).length

    return {
        kinds: goods.length,
        classes,
        keptApart,
        loadLimited,
        dedicated,
        pieces,
        weight,
        volume,
        crateKinds: crates.length,
        containers: used.length,
        capacity,
        fill: capacity > 0 ? filled / capacity * 100 : 0,
        left: packResult?.items?.length || 0,
    }
}

function articleIndex(elements) {
    const index = new Map()
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

    elements
        .filter(element => element.type === itemType && element.enabled)
        .forEach((element, at) => {
            index.set(element.id, {
                label: at < letters.length ? letters[at] : `#${at + 1}`,
                dims: `${element.width}×${element.height}×${element.depth}`,
                group: element.group,
                color: element.color || itemColorCss({ id: element.id, group: element.group }),
            })
        })

    return index
}

function articleOf(index, item) {
    const base = String(item.id || '').replace(/#\d+$/, '')

    return index.get(base) || {
        label: '—',
        dims: `${Math.round(item.width)}×${Math.round(item.height)}×${Math.round(item.depth)}`,
        group: item.group,
        color: itemColorCss(item),
    }
}

function loadingPlan(result) {
    return (result.boxes || [])
        .filter(box => box.items.length > 0)
        .map((box, index) => {
            const steps = box.items
                .slice()
                .sort((a, b) => a.position.z - b.position.z
                    || a.position.y - b.position.y
                    || a.position.x - b.position.x)

            const layers = []

            for (const item of steps) {
                const floor = Math.round(item.position.z)
                let layer = layers.find(l => l.floor === floor)

                if (!layer) {
                    layer = { floor, items: [] }
                    layers.push(layer)
                }

                layer.items.push(item)
            }

            const weight = box.items.reduce((total, item) => total + item.weight, 0)

            return {
                number: String(index + 1).padStart(2, '0'),
                id: box.id,
                box,
                dims: `${Math.round(box.width)}×${Math.round(box.height)}×${Math.round(box.depth)}`,
                count: box.items.length,
                fill: box.volumeAvailable > 0
                    ? `${Math.round(box.volumeUsed / box.volumeAvailable * 100)}%`
                    : '—',
                weight: formatWeight(weight),
                gross: formatWeight(weight + (box.emptyWeight || 0)),
                limit: formatWeight(box.weight),
                layers,
            }
        })
}

function summarise(result) {
    const stats = summaryValues(result)
    const report = result.report || {}

    const cells = [
        { label: 'boxes', value: stats.boxes, ink: 'var(--ink)' },
        { label: 'packed', value: stats.packed, ink: 'var(--ink)' },
        { label: 'left', value: stats.left, ink: stats.left === '0' ? 'var(--ink-faint)' : 'var(--alarm)' },
        { label: 'fill', value: stats.fill, ink: 'var(--accent)' },
        { label: 'time', value: stats.time, ink: 'var(--ink-muted)' },
    ]

    if (report.boundBoxes > 0) {
        cells.push({
            label: 'least possible',
            value: report.gapBoxes > 0 ? `${report.boundBoxes} (+${report.gapBoxes})` : String(report.boundBoxes),
            ink: report.gapBoxes > 0 ? 'var(--ink-muted)' : 'var(--accent)',
        })
    }

    if (report.nodes > 0) {
        cells.push({ label: 'states searched', value: String(report.nodes), ink: 'var(--ink-muted)' })
    }

    if (report.truncated) {
        cells.push({ label: 'budget', value: 'ran out', ink: 'var(--alarm)' })
    }

    return Object.assign({}, stats, { cells, algorithm: report.algorithm || '' })
}

function summaryValues(result) {
    const used = (result.boxes || []).filter(box => box.items.length > 0)
    const packed = used.reduce((total, box) => total + box.items.length, 0)
    const capacity = used.reduce((total, box) => total + box.volumeAvailable, 0)
    const filled = used.reduce((total, box) => total + box.volumeUsed, 0)

    return {
        boxes: String(used.length),
        packed: String(packed),
        left: String((result.items || []).length),
        fill: capacity > 0 ? `${Math.round(filled / capacity * 100)}%` : '—',
        time: `${result.executionTime ?? 0} ms`,
    }
}

const rotationValues = ['best-fit', 'keep-flat', 'never']

function parseDatum(text, type, flat) {
    const parts = text.split(';').map(part => part.trim()).filter(part => part !== '')
    const fields = flat ? 3 : 4

    if (parts.length < fields) {
        return null
    }

    const numbers = parts.slice(0, fields).map(Number)
    if (numbers.some(value => !isFinite(value) || value <= 0)) {
        return null
    }

    if (flat) {
        numbers.splice(2, 0, FLAT_DEPTH)
    }

    const extras = {}
    for (const part of parts.slice(fields)) {
        const eq = part.indexOf('=')
        if (eq < 1) {
            return null
        }
        extras[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim()
    }

    if (extras.rot !== undefined && !rotationValues.includes(extras.rot)) {
        return null
    }

    let inner = { innerWidth: 0, innerHeight: 0, innerDepth: 0 }

    if (extras.inner !== undefined) {
        const sides = extras.inner.split(/[x×*]/).map(Number)

        if (sides.length !== (flat ? 2 : 3) || sides.some(v => !isFinite(v) || v <= 0)) {
            return null
        }

        if (flat) {
            sides.splice(2, 0, FLAT_DEPTH)
        }

        inner = { innerWidth: sides[0], innerHeight: sides[1], innerDepth: sides[2] }
    }

    const tare = extras.tare === undefined ? 0 : Number(extras.tare)

    if (!isFinite(tare) || tare < 0) {
        return null
    }

    const accepts = (extras.takes || '').split(',').map(part => part.trim()).filter(Boolean)

    if (extras.takes !== undefined && accepts.length === 0) {
        return null
    }

    const separateFrom = (extras.apart || '').split(',').map(part => part.trim()).filter(Boolean)

    if (extras.apart !== undefined && separateFrom.length === 0) {
        return null
    }

    const nothingOnTop = extras.top === 'none'
    const maxLoadOnTop = extras.top === undefined || nothingOnTop ? 0 : Number(extras.top)

    if (!isFinite(maxLoadOnTop) || maxLoadOnTop < 0) {
        return null
    }

    return {
        width: numbers[0],
        height: numbers[1],
        depth: numbers[2],
        weight: numbers[3],
        rotation: extras.rot || '',
        group: extras.group || '',
        quantity: extras.qty ? parseInt(extras.qty, 10) : 0,
        maxLoadOnTop,
        nothingOnTop,
        class: extras.class || '',
        separateFrom,
        accepts,
        tare,
        innerWidth: inner.innerWidth,
        innerHeight: inner.innerHeight,
        innerDepth: inner.innerDepth,
        type,
    }
}

class Datum {
    constructor(id, type, width, height, depth, weight, options = {}) {
        this.id = id
        this.type = type
        this.width = Number(width)
        this.height = Number(height)
        this.depth = Number(depth)
        this.weight = Number(weight)
        this.color = options.color || ''
        this.rotation = options.rotation || ''
        this.group = options.group || ''
        this.quantity = options.quantity || 0
        this.maxLoadOnTop = Number(options.maxLoadOnTop) || 0
        this.nothingOnTop = Boolean(options.nothingOnTop)
        this.class = options.class || ''
        this.separateFrom = options.separateFrom || []
        this.accepts = options.accepts || []
        this.tare = Number(options.tare) || 0
        this.innerWidth = Number(options.innerWidth) || 0
        this.innerHeight = Number(options.innerHeight) || 0
        this.innerDepth = Number(options.innerDepth) || 0
        this.enabled = true
    }

    toString() {
        const parts = [`${this.width}x${this.height}x${this.depth}`, `wg${this.weight}`]
        if (this.quantity > 1) parts.push(`x${this.quantity}`)
        if (this.rotation) parts.push(this.rotation)
        if (this.group) parts.push(`[${this.group}]`)
        if (this.accepts.length) parts.push(`takes ${this.accepts.join(', ')}`)
        if (this.separateFrom.length) parts.push(`away from ${this.separateFrom.join(', ')}`)
        if (this.nothingOnTop) parts.push('nothing on top')
        else if (this.maxLoadOnTop) parts.push(`carries ${this.maxLoadOnTop}`)
        return parts.join(' ')
    }

    toExport() {
        return [
            this.type === boxType ? 'box' : 'item',
            this.width, this.height, this.depth, this.weight,
            Math.max(this.quantity || 1, 1),
            this.rotation,
            this.group,
            this.color,
            this.enabled ? 1 : 0,
            this.tare || 0,
            this.innerWidth ? `${this.innerWidth}x${this.innerHeight}x${this.innerDepth}` : '',
            this.nothingOnTop ? 'none' : (this.maxLoadOnTop || 0),
            this.class,
            this.separateFrom.join(','),
            this.accepts.join(','),
        ].join(';')
    }
}

export default class ItemComponent extends React.Component {
    state = {
        hasError: false,
        text: '',
        type: itemType,
        elements: [],
        packResult: null,
        selectedBox: null,
        selectedItem: null,
        editing: null,
        advanced: false,
        flat: false,
        stash: null,
        notice: null,
        printing: false,
        requestError: null,
        comparison: null,
        comparing: false,
        stagePanel: 'boxes',
        clearArmed: null,
        leftWidth: 330,
        rightWidth: 300,
        boxesHeight: 200,
        showEmptyBoxes: false,
        showAnimation: true,
        animationSpeed: 1,
        meta: null,
        settings: { ...defaultSettings },
    };

    constructor() {
        super(...arguments)
        this.renderTimeout = null;
        this.lastRenderElements = null;
        this.comparedElements = null;
    }

    async componentDidMount() {
        let { elements } = this.state;

        const meta = await api('/bp3meta', {});
        this.setState({ meta });

        for (const box of await api('/bp3boxes', {})) {
            elements = elements.concat(new Datum(
                box.id,
                boxType,
                box.width, box.height,
                box.depth,
                box.weight))
        }

        this.setState({ elements });

        this.props.playground.onBoxSelect = (boxId) => {
            this.setState({ selectedBox: boxId, selectedItem: null });
        }

        this.props.playground.onBoxDeselect = () => {
            this.setState({ selectedBox: null, selectedItem: null });
        }

        this.props.playground.onItemDeselect = () => {
            this.setState({ selectedItem: null });
        }

        this.props.playground.onItemSelect = (itemId, boxId) => {
            this.setState(state => ({
                selectedItem: itemId,
                selectedBox: boxId || state.selectedBox,
            }), () => {
                const row = document.querySelector('.manifest-row.is-active')

                if (row) {
                    row.scrollIntoView({ block: 'nearest' })
                }
            });
        }

        await this.playgroundRender(elements)
        this.lastRenderElements = this.getElementsSnapshot(elements);
    }

    componentDidUpdate(prevProps, prevState) {
        const elementsChanged = prevState.elements !== this.state.elements;
        const settingsChanged = JSON.stringify(prevState.settings) !== JSON.stringify(this.state.settings);

        const elementsSnapshot = this.getElementsSnapshot(this.state.elements);
        const enabledStateChanged = this.lastRenderElements !== elementsSnapshot;

        if (this.state.elements.filter(e => e.enabled).length === 0) {
            if (this.state.packResult) {
                this.lastRenderElements = elementsSnapshot
                this.props.playground.destroy()
                this.props.playground.setEmpty(true)
                this.setState({ packResult: null, selectedBox: null, selectedItem: null })
            }

            return
        }

        if (elementsChanged || settingsChanged || enabledStateChanged) {
            if (this.state.comparison && this.comparedElements !== elementsSnapshot) {
                this.setState({ comparison: null }, () => {
                    if (this.state.stagePanel === 'strategies') {
                        this.runComparison()
                    }
                })
            }

            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
            }

            this.renderTimeout = setTimeout(() => {
                this.playgroundRender(this.state.elements);
                this.lastRenderElements = this.getElementsSnapshot(this.state.elements);
            }, 300);
        }
    }

    componentWillUnmount() {
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }
    }

    getElementsSnapshot(elements) {
        return elements
            .filter(e => e.enabled)
            .map(e => [e.id, e.enabled, e.type, e.width, e.height, e.depth,
                e.weight, e.rotation, e.group, e.quantity, e.color].join(':'))
            .sort()
            .join('|');
    }

    setText = e => {
        this.setState({ text: e.target.value, hasError: false });
    }
    setType = v => {
        this.setState({ type: v })
    }
    updateElement = (id, patch) => {
        this.setState(state => ({
            elements: state.elements.map(element => {
                if (element.id !== id) {
                    return element
                }

                const next = Object.assign(Object.create(Datum.prototype), element, patch)
                return next
            }),
        }))
    }


    removeElement = id => {
        this.setState(state => ({
            elements: state.elements.filter(element => element.id !== id),
            editing: state.editing === id ? null : state.editing,
        }))
    }

    runComparison = async () => {
        const { elements, settings } = this.state
        const enabled = elements.filter(e => e.enabled)

        if (this.state.comparing) {
            return
        }

        this.comparedElements = this.getElementsSnapshot(elements)
        this.setState({ comparing: true })

        const rows = await api('/bp3compare', {
            boxes: enabled.filter(e => e.type === boxType).map(e => ({
                id: e.id,
                width: e.width, height: e.height, depth: e.depth,
                weight: e.weight,
                quantity: e.quantity,
                emptyWeight: e.tare || undefined,
                accepts: e.accepts && e.accepts.length ? e.accepts : undefined,
                innerWidth: e.innerWidth || undefined,
                innerHeight: e.innerHeight || undefined,
                innerDepth: e.innerDepth || undefined,
            })),
            items: enabled.filter(e => e.type === itemType).map(e => ({
                id: e.id,
                width: e.width, height: e.height, depth: e.depth,
                weight: e.weight,
                rotation: e.rotation,
                group: e.group,
                maxLoadOnTop: e.maxLoadOnTop || undefined,
                nothingOnTop: e.nothingOnTop || undefined,
                class: e.class || undefined,
                separateFrom: e.separateFrom && e.separateFrom.length ? e.separateFrom : undefined,
                quantity: e.quantity,
            })),
            supportRatio: settings.supportRatio,
            balanceBoxes: settings.balanceWeight ? 12 : 0,
            singleContainer: settings.singleContainer,
        })

        if (rows.error) {
            this.setState({ comparing: false, requestError: rows.error })

            return
        }

        const usable = rows.filter(row => !row.failed)

        for (const row of rows) {
            row.best = !row.failed && usable.every(other => compareOutcome(row, other) <= 0)
        }

        this.setState({ comparison: rows, comparing: false, stagePanel: 'strategies' })
    }

    openStrategies = () => {
        this.setState({ stagePanel: 'strategies', boxesHeight: Math.max(this.state.boxesHeight, 260) },
            () => {
                this.resizeScene()

                if (!this.state.comparison && !this.state.comparing) {
                    this.runComparison()
                }
            })
    }

    setFlat = next => {
        if (next === this.state.flat) {
            return
        }

        this.setState(state => ({
            flat: next,
            elements: state.stash == null ? flatDefaults(next) : state.stash,
            stash: state.elements,
            editing: null,
            packResult: null,
            selectedBox: null,
            selectedItem: null,
            comparison: null,
            printing: false,
        }))
    }

    mountScene = node => {
        if (!node || this.sceneNode === node) {
            return
        }

        this.sceneNode = node
        this.props.playground.attach(node)
    }

    onPrint = event => {
        if (event) {
            event.preventDefault()
        }

        const { packResult } = this.state

        if (!packResult || !packResult.boxes) {
            this.setState({ notice: { tone: 'is-warning', text: 'Pack something first — there is no plan to print yet.' } })

            return
        }

        this.setState({ printing: true })
    }

    toggleEmptyBoxes = () => {
        this.setState(state => ({ showEmptyBoxes: !state.showEmptyBoxes }),
            () => this.playgroundRender(this.state.elements))
    }

    toggleEditing = id => {
        this.setState(state => ({ editing: state.editing === id ? null : id }))
    }

    setAllEnabled = (type, enabled) => {
        this.setState(state => ({
            elements: state.elements.map(element => element.type === type
                ? Object.assign(Object.create(Datum.prototype), element, { enabled })
                : element),
        }))
    }

    removeAll = type => {
        this.setState(state => ({
            elements: state.elements.filter(element => element.type !== type),
            editing: null,
        }))
    }

    switchEnabled = id => {
        const { elements } = this.state;
        const element = elements.find(
            e => e.id === id,
        )

        if (element) {
        element.enabled = !element.enabled
            this.setState({ elements: [...elements] })
        }
    }

    addElement = () => {
        const { elements, type, text } = this.state;

        const lines = text.split(/[\n,]+/).map(line => line.trim()).filter(Boolean)
        if (lines.length === 0) {
            this.setState({ hasError: true })

            return
        }

        const added = []

        for (const line of lines) {
            const parsed = parseDatum(line, type, this.state.flat)
            if (parsed === null) {
                this.setState({ hasError: true })

                return
            }

            added.push(new Datum(generateUUID(), type,
                parsed.width, parsed.height, parsed.depth, parsed.weight, parsed))
        }

        this.setState({
            elements: elements.concat(added),
            text: '',
            hasError: false
        });
    }

    onPaste = event => {
        const pasted = (event.clipboardData || window.clipboardData).getData('text')
        if (!pasted || !/[\n,]/.test(pasted)) {
            return
        }

        event.preventDefault()
        this.setState({ text: pasted }, this.addElement)
    }

    playgroundRender = async elements => {
        const enabled = elements.filter(e => e.enabled)
        const { settings } = this.state
        const generation = (this.renderGeneration = (this.renderGeneration || 0) + 1)

        const items = enabled.filter(e => e.type === itemType)

        setColorOverrides(items.map(e => [e.group || e.id, e.color]))
        resetColors(items.map(e => e.group || e.id))

        const requestData = {
            boxes: enabled.filter(e => e.type === boxType).map(e => ({
                id: e.id,
                width: e.width, height: e.height, depth: e.depth,
                weight: e.weight,
                quantity: e.quantity,
                emptyWeight: e.tare || undefined,
                accepts: e.accepts && e.accepts.length ? e.accepts : undefined,
                innerWidth: e.innerWidth || undefined,
                innerHeight: e.innerHeight || undefined,
                innerDepth: e.innerDepth || undefined,
            })),
            items: enabled.filter(e => e.type === itemType).map(e => ({
                id: e.id,
                width: e.width, height: e.height, depth: e.depth,
                weight: e.weight,
                rotation: e.rotation,
                group: e.group,
                maxLoadOnTop: e.maxLoadOnTop || undefined,
                nothingOnTop: e.nothingOnTop || undefined,
                class: e.class || undefined,
                separateFrom: e.separateFrom && e.separateFrom.length ? e.separateFrom : undefined,
                quantity: e.quantity,
            })),
            supportRatio: settings.supportRatio,
            balanceBoxes: settings.balanceWeight ? 12 : 0,
            freeSpaceCorners: settings.freeSpaceCorners || undefined,
            merit: settings.merit !== 'contact-first' ? settings.merit : undefined,
            finishers: settings.rehome ? ['Rehome'] : undefined,
            singleContainer: settings.singleContainer,
        };

        if (settings.auto) {
            requestData.parallel = true;
            requestData.goal = settings.goal;
        } else if (settings.search) {
            requestData.search = { nodes: 128, branching: 3 };

            if (settings.searchFills) {
                requestData.searchFills = true;
                requestData.order = settings.order;
                requestData.selection = settings.selection;
            }
        } else {
            requestData.order = settings.order;
            requestData.selection = settings.selection;
        }

        const packResult = await api('/bp3', requestData)

        if (generation !== this.renderGeneration) {
            return
        }

        this.props.playground.destroy();

        if (packResult.error) {
            this.setState({ packResult: null, requestError: packResult.error });
            return
        }

        const firstLoaded = (packResult.boxes || []).find(box => box.items.length > 0)

        this.setState({
            packResult,
            requestError: null,
            selectedBox: firstLoaded ? firstLoaded.id : null,
            selectedItem: null,
        });

        this.props.playground.setFlat(this.state.flat);
        this.props.playground.showUnusedBoxes = this.state.showEmptyBoxes;
        this.props.playground.showAnimation = this.state.showAnimation;
        this.props.playground.animationSpeed = this.state.animationSpeed;
        this.props.playground.setSummary(summarise(packResult));

        this.props.playground.render(packResult)
    }

    updateSettings = patch => {
        this.setState(state => ({ settings: { ...state.settings, ...patch } }));
    }

    setSetting = (key, transform = v => v) => e => {
        this.updateSettings({ [key]: transform(e.target.value) });
    }

    toggleSetting = key => () => {
        this.updateSettings({ [key]: !this.state.settings[key] });
    }

    applyStrategyPreset = e => {
        const value = parseInt(e.target.value, 10);

        if (value === AUTO_PRESET) {
            this.updateSettings({ auto: true, search: false });

            return
        }

        const preset = (this.state.meta?.rules || []).find(s => s.name === value);

        if (preset) {
            this.updateSettings({ auto: false, order: preset.order, selection: preset.selection });
        }
    }

    toggleAlgorithm = name => {
        const { algorithms } = this.state.settings;
        const next = algorithms.includes(name)
            ? algorithms.filter(a => a !== name)
            : [...algorithms, name].sort();

        this.updateSettings({ algorithms: next });
    }

    selectBox = (boxId) => {
        this.props.playground.selectBox(boxId);
        this.setState({ selectedBox: boxId, selectedItem: null });
    }

    selectItem = (itemId, focus = false) => {
        this.props.playground.selectItem(itemId, focus);
        this.setState({ selectedItem: itemId });
    }

    toggleAnimation = () => {
        const newValue = !this.state.showAnimation;
        this.setState({ showAnimation: newValue });
        this.props.playground.showAnimation = newValue;
    }

    setAnimationSpeed = (e) => {
        const speed = parseFloat(e.target.value);
        this.setState({ animationSpeed: speed });
        this.props.playground.animationSpeed = speed;
    }

    calculateBoxStats = (box) => {
        const totalVolume = box.width * box.height * box.depth;
        const usedVolume = box.items.reduce((sum, item) => {
            return sum + (item.width * item.height * item.depth);
        }, 0);
        const usedWeight = box.items.reduce((sum, item) => sum + item.weight, 0);
        const grossWeight = box.grossWeight != null
            ? box.grossWeight
            : usedWeight + (box.emptyWeight || 0);
        const utilization = totalVolume > 0 ? (usedVolume / totalVolume * 100) : 0;
        const weightUtilization = box.weight > 0 ? (grossWeight / box.weight * 100) : 0;

        return {
            totalVolume: Math.round(totalVolume),
            usedVolume: Math.round(usedVolume),
            freeVolume: Math.round(totalVolume - usedVolume),
            utilization: Math.round(utilization * 10) / 10,
            usedWeight: Math.round(usedWeight),
            grossWeight: Math.round(grossWeight),
            tare: Math.round(box.emptyWeight || 0),
            weightUtilization: Math.round(weightUtilization * 10) / 10,
            itemsCount: box.items.length
        };
    }

    onImport = event => {
        if (event) {
            event.preventDefault()
        }

        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.csv,.txt'
        input.style.display = 'none'

        input.onchange = async pick => {
            const file = pick.target.files[0]

            if (file) {
                try {
                    this.applyImport(await file.text())
                } catch (error) {
                    this.setState({ notice: { tone: 'is-danger', text: `Could not read the file: ${error.message}` } })
                }
            }

            input.remove()
        }

        document.body.appendChild(input)
        input.click()
    }

    applyImport = text => {
        const imported = []
        const errors = []

        text.split(/\r?\n/).forEach((raw, index) => {
            const line = raw.trim()

            if (!line || line.startsWith('#') || /^kind\s*;/i.test(line)) {
                return
            }

            const parsed = parseExported(line)

            if (parsed === null) {
                errors.push(index + 1)

                return
            }

            const datum = new Datum(generateUUID(), parsed.type,
                parsed.width, parsed.height, parsed.depth, parsed.weight, parsed)
            datum.enabled = parsed.enabled

            imported.push(datum)
        })

        if (imported.length === 0) {
            this.setState({ notice: { tone: 'is-danger', text: 'Nothing in that file could be read as a box or an item.' } })

            return
        }

        const boxes = imported.filter(e => e.type === boxType).length
        const summary = `Imported ${boxes} boxes and ${imported.length - boxes} items`
            + (errors.length > 0 ? `; skipped ${errors.length} unreadable line${errors.length > 1 ? 's' : ''}` : '')

        this.setState({
            elements: imported,
            editing: null,
            notice: { tone: errors.length > 0 ? 'is-warning' : 'is-info', text: summary },
        })
    }

    onExport = event => {
        if (event) {
            event.preventDefault()
        }

        const { elements } = this.state

        if (elements.length === 0) {
            this.setState({ notice: { tone: 'is-warning', text: 'Nothing to export yet.' } })

            return
        }

        const csv = [EXPORT_HEADER, ...elements.map(e => e.toExport())].join('\n')
        const link = document.createElement('a')

        link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
        link.download = `boxpacker3-${elements.length}-rows.csv`
        link.click()

        URL.revokeObjectURL(link.href)

        this.setState({ notice: { tone: 'is-info', text: `Exported ${elements.length} rows.` } })
    }

    resizeScene() {
        window.dispatchEvent(new Event('resize'))
    }

    startDrag(event, key, sign, slots) {
        event.preventDefault()

        const vertical = key === 'boxesHeight'
        const start = vertical ? event.clientY : event.clientX
        const from = this.state[key]
        const least = slots[0]
        const most = slots[slots.length - 1]

        const move = moved => {
            const travelled = (vertical ? moved.clientY : moved.clientX) - start
            const free = Math.min(most, Math.max(least, from + travelled * sign))
            const nearest = slots.reduce((best, slot) =>
                Math.abs(slot - free) < Math.abs(best - free) ? slot : best, slots[0])
            const next = Math.abs(nearest - free) <= SNAP ? nearest : Math.round(free)

            this.setState({ [key]: next }, () => this.resizeScene())
        }

        const stop = () => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', stop)
            document.body.classList.remove('is-dragging')
            this.resizeScene()
        }

        document.body.classList.add('is-dragging')
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
    }

    render({ }, { elements, type, text, hasError, packResult, selectedBox, selectedItem, editing, advanced, comparison, comparing, stagePanel, clearArmed, leftWidth, rightWidth, boxesHeight, notice, printing, flat, showEmptyBoxes, showAnimation, animationSpeed, meta, settings, requestError }) {
        const palette = paletteCss()
        const listed = elements.filter(datum => datum.type === type)
        const active = listed.filter(datum => datum.enabled)
        const totalWeight = active.reduce((sum, d) => sum + d.weight * Math.max(d.quantity || 1, 1), 0)
        const selectedBoxData = packResult && selectedBox
            ? packResult.boxes.find(b => b.id === selectedBox)
            : null;
        const selectedBoxStats = selectedBoxData ? this.calculateBoxStats(selectedBoxData) : null;

        const articles = articleIndex(elements)
        const selectedItemData = selectedBoxData && selectedItem
            ? selectedBoxData.items.find(item => item.id === selectedItem)
            : null

        return (
            <div className="app">
                <header className="topbar">
                    <span className="brand">
                        <svg className="brand-mark" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                            <path d="M12 2.6 3.2 7.1v9.8L12 21.4l8.8-4.5V7.1L12 2.6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                            <path d="M3.2 7.1 12 11.6l8.8-4.5M12 11.6v9.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
                        </svg>
                        <span className="brand-name">BoxPacker3</span>
                    </span>
                    <span className="mode-switch">
                        <button type="button" className={flat ? '' : 'is-on'}
                            onClick={() => this.setFlat(false)}
                            title="Boxes and cargo in three dimensions">3D</button>
                        <button type="button" className={flat ? 'is-on' : ''}
                            onClick={() => this.setFlat(true)}
                            title="Sheets and rectangles — every depth is one unit">2D</button>
                    </span>
                    <span className="brand-tag">{flat ? 'sheet nesting' : '3d bin packing playground'}</span>
                    {packResult && (
                        <span className="run-summary">
                            {summarise(packResult).cells.map(cell => (
                                <span className="run-stat" key={cell.label}>
                                    <span className="run-label">{cell.label}</span>
                                    <span className="run-value" style={{ color: cell.ink }}>{cell.value}</span>
                                </span>
                            ))}
                        </span>
                    )}
                    <span style={{ flex: 1 }}></span>
                    <a href="#" onClick={this.onImport} className="topbar-link">Import</a>
                    <a href="#" onClick={this.onExport} className="topbar-link">Export</a>
                    <a href="#" onClick={this.onPrint} className="topbar-link">Print plan</a>
                </header>

                <div className="workspace" style={{
                    gridTemplateColumns: `${leftWidth}px 7px minmax(0, 1fr) 7px ${rightWidth}px`,
                }}>
                    <aside className="pane pane-left">
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <strong><span className="glyph">▤</span>Settings</strong>
                        </p>
                        <form onSubmit={this.addElement} action="javascript:">
                        <div className="panel-block">
                        <p className="control has-icons-right">
                        <input value={text} onInput={this.setText} onPaste={this.onPaste}
                        className="input is-primary" type="text"
                        placeholder={flatPlaceholder(flat, type, boxType)} />
                        {hasError
                        ? <p className="help is-danger">
                        Four positive numbers, then optional {type === boxType ? 'qty=N and takes=NAME' : 'rot=best-fit|keep-flat|never and group=NAME'}
                        </p>
                        : <p className="help">
                        {type === boxType
                        ? 'Width, height, depth in mm, then the weight limit in g. Optional qty=N and takes=NAME,NAME to limit the box to certain goods.'
                        : 'Width, height, depth in mm, then weight in g. Optional qty=N, group=NAME, rot= when the item must stay upright, top=none or top=WEIGHT for what may rest on it, and class=NAME with apart=NAME,NAME for goods that must travel separately.'}
                        </p>
                        }
                        </p>
                        </div>
                        <p className="panel-tabs">
                        <a href="#" className={type === boxType ? "is-active" : ""} onClick={() => this.setType(boxType)}>Boxes</a>
                        <a href="#" className={type === itemType ? "is-active" : ""} onClick={() => this.setType(itemType)}>Items</a>
                        </p>
                        </form>
                        <div className="list-toolbar">
                        <span className="list-count">
                        {active.length}/{listed.length} on
                        {listed.length > 0 && ` · ${formatWeight(totalWeight)}`}
                        </span>
                        <span className="list-actions">
                        <button type="button" onClick={() => this.setAllEnabled(type, true)} disabled={listed.length === 0}>All on</button>
                        <button type="button" onClick={() => this.setAllEnabled(type, false)} disabled={listed.length === 0}>All off</button>
                        <button type="button"
                        className={clearArmed === type ? 'is-danger is-on' : 'is-danger'}
                        disabled={listed.length === 0}
                        title={clearArmed === type
                        ? 'Click again to throw the list away'
                        : 'Remove every line in this list'}
                        onClick={() => {
                        if (clearArmed === type) {
                        this.removeAll(type)
                        this.setState({ clearArmed: null })

                        return
                        }

                        this.setState({ clearArmed: type })
                        window.setTimeout(() => this.setState(state =>
                        state.clearArmed === type ? { clearArmed: null } : null), 3000)
                        }}>
                        {clearArmed === type ? 'sure?' : 'Clear'}
                        </button>
                        </span>
                        </div>

                        { listed.length === 0 ? (
                        <div className="empty-state">
                        <p>No {type === boxType ? 'boxes' : 'items'} yet</p>
                        <p className="empty-hint">
                        Type {type === boxType ? '400;300;200;20000' : '120;90;70;500'} above, or import a CSV.
                        </p>
                        </div>
                        ) : (
                        listed.map(datum => (
                        <div key={datum.id} className={`row${datum.enabled ? '' : ' is-off'}${editing === datum.id ? ' is-editing' : ''}`}>
                        <div className="row-head">
                        <input type="checkbox" checked={datum.enabled}
                        title={datum.enabled ? 'Exclude from packing' : 'Include in packing'}
                        onChange={() => this.switchEnabled(datum.id)} />
                        <button type="button" className="row-label" onClick={() => this.toggleEditing(datum.id)}>
                        <span className="row-line">
                        {type === itemType && (
                        <span className="dot" title="Colour in the scene — click the row to change it"
                        style={{ background: swatchOf(datum), color: swatchOf(datum) }} />
                        )}
                        <span className="row-dims">{datum.width}×{datum.height}×{datum.depth}</span>
                        <span className="row-weight">{formatWeight(datum.weight)}</span>
                        <span className="row-qty" title="Click the row to change the count">
                        ×{datum.quantity || 1}
                        </span>
                        </span>
                        {(datum.rotation || datum.group || datum.tare > 0 || datum.innerWidth > 0) && (
                        <span className="row-line row-meta">
                        {datum.rotation && <span className="tag">{datum.rotation}</span>}
                        {datum.group && <span className="tag is-dark">{datum.group}</span>}
                        {datum.tare > 0 && (
                        <span className="tag is-warning" title="Weight of the empty box">tare {formatWeight(datum.tare)}</span>
                        )}
                        {datum.innerWidth > 0 && (
                        <span className="tag is-info" title="Usable space inside the liner">inner {datum.innerWidth}×{datum.innerHeight}{flat ? '' : `×${datum.innerDepth}`}</span>
                        )}
                        </span>
                        )}
                        </button>
                        <span className="row-tools">
                        <button type="button" title="Remove" className="is-danger" onClick={() => this.removeElement(datum.id)}>×</button>
                        </span>
                        </div>

                        {editing === datum.id && (
                        <div className="row-editor">
                        <div className="row-editor-grid">
                        {['width', 'height', 'depth'].map(axis => (
                        <label key={axis}>
                        <span>{axis}</span>
                        <input className="input" type="number" min="1" value={datum[axis]}
                        onInput={e => this.updateElement(datum.id, { [axis]: Number(e.target.value) || 1 })} />
                        </label>
                        ))}
                        <label>
                        <span>{type === boxType ? 'max weight' : 'weight'}</span>
                        <input className="input" type="number" min="0" value={datum.weight}
                        onInput={e => this.updateElement(datum.id, { weight: Number(e.target.value) || 0 })} />
                        </label>

                        <label>
                        <span>quantity</span>
                        <input className="input" type="number" min="1" value={datum.quantity || 1}
                        onInput={e => this.updateElement(datum.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })} />
                        </label>

                        {type === boxType && (
                        <>
                        <label>
                        <span>tare</span>
                        <input className="input" type="number" min="0" value={datum.tare}
                        title="What the empty box weighs; it counts against the limit"
                        onInput={e => this.updateElement(datum.id, { tare: Number(e.target.value) || 0 })} />
                        </label>
                        <label className="liner-field">
                        <span>liner — usable space inside</span>
                        <span className="liner-row">
                        {(flat ? ['innerWidth', 'innerHeight'] : ['innerWidth', 'innerHeight', 'innerDepth']).map(axis => (
                        <input key={axis} className="input" type="number" min="0" placeholder="full"
                        value={datum[axis] || ''}
                        onInput={e => this.updateElement(datum.id, { [axis]: Number(e.target.value) || 0 })} />
                        ))}
                        <button type="button" className="swatch-reset" title="Drop the liner"
                        onClick={() => this.updateElement(datum.id, { innerWidth: 0, innerHeight: 0, innerDepth: 0 })}>none</button>
                        </span>
                        </label>
                        <label title="Classes of goods this box takes, separated by commas. Empty takes anything.">
                        <span>takes</span>
                        <input className="input" type="text" placeholder="anything"
                        value={datum.accepts.join(', ')}
                        onInput={e => this.updateElement(datum.id, {
                        accepts: e.target.value.split(',').map(part => part.trim()).filter(Boolean),
                        })} />
                        </label>
                        </>
                        )}

                        {type === itemType && (
                        <>
                        <label className="swatch-field">
                        <span>colour</span>
                        <span className="swatch-row">
                        <button type="button"
                        className={`swatch-chip is-auto${datum.color ? '' : ' is-on'}`}
                        title="Back to the palette colour"
                        onClick={() => this.updateElement(datum.id, { color: '' })}>
                        auto
                        </button>
                        {palette.map(colour => (
                        <button key={colour} type="button"
                        className={`swatch-chip${datum.color === colour ? ' is-on' : ''}`}
                        style={{ background: colour }}
                        title={colour}
                        onClick={() => this.updateElement(datum.id, { color: colour })} />
                        ))}
                        </span>
                        </label>
                        <label>
                        <span>rotation</span>
                        <div className="select is-small is-fullwidth">
                        <select value={datum.rotation || 'best-fit'}
                        onChange={e => this.updateElement(datum.id, { rotation: e.target.value })}>
                        {(meta?.rotations || []).map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                        </select>
                        </div>
                        </label>
                        <label>
                        <span>group</span>
                        <input className="input" type="text" placeholder="none" value={datum.group}
                        onInput={e => this.updateElement(datum.id, { group: e.target.value })} />
                        </label>
                        <label title="Weight this item may carry. Empty means it carries anything.">
                        <span>carries</span>
                        <input className="input" type="number" min="0" placeholder="any"
                        disabled={datum.nothingOnTop}
                        value={datum.maxLoadOnTop || ''}
                        onInput={e => this.updateElement(datum.id, { maxLoadOnTop: Number(e.target.value) || 0 })} />
                        </label>
                        <label title="What these goods are: food, chemicals, batteries.">
                        <span>class</span>
                        <input className="input" type="text" placeholder="none" value={datum.class}
                        onInput={e => this.updateElement(datum.id, { class: e.target.value })} />
                        </label>
                        <label title="Classes these goods may not share a box with, separated by commas.">
                        <span>keep from</span>
                        <input className="input" type="text" placeholder="nothing"
                        value={datum.separateFrom.join(', ')}
                        onInput={e => this.updateElement(datum.id, {
                        separateFrom: e.target.value.split(',').map(part => part.trim()).filter(Boolean),
                        })} />
                        </label>
                        <label className="check" title="Nothing may be stacked on this item.">
                        <input type="checkbox" checked={datum.nothingOnTop}
                        onChange={e => this.updateElement(datum.id, { nothingOnTop: e.target.checked })} />
                        <span>nothing on top</span>
                        </label>
                        </>
                        )}
                        </div>
                        </div>
                        )}
                        </div>
                        ))
                        )}
                        </nav>

                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <span className="heading-row">
                        <strong><span className="glyph">◱</span>Algorithm</strong>
                        <span className="heading-tools">
                        <button type="button" className={advanced ? 'is-on' : ''}
                        onClick={() => this.setState({ advanced: !advanced })}
                        title="Item order, box selection, search, constraints">
                        {advanced ? 'fewer settings' : 'more settings'}
                        </button>
                        </span>
                        </span>
                        </p>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">Preset</label>
                        <div className="select is-fullwidth">
                        <select
                        value={settings.auto ? AUTO_PRESET : ((meta?.rules || []).find(
                        s => s.order === settings.order && s.selection === settings.selection)?.name ?? '')}
                        onChange={this.applyStrategyPreset}>
                        <option value="" disabled>Custom</option>
                        <option value={AUTO_PRESET}>Auto — best of every rule</option>
                        {(meta?.rules || []).map(s => (
                        <option key={s.name} value={s.name}>
                        {s.name} — {labelOf(meta?.selections, s.selection)}, {labelOf(meta?.orders, s.order).toLowerCase()}
                        </option>
                        ))}
                        </select>
                        </div>
                        <p className="help">
                        {settings.auto
                        ? 'Runs every rule at once and keeps whichever result the goal below prefers. Asking for the fewest boxes also empties boxes into one another afterwards.'
                        : ruleGist(meta, settings.selection)
                        ? `${labelOf(meta?.selections, settings.selection)}: ${ruleGist(meta, settings.selection)}, ${labelOf(meta?.orders, settings.order).toLowerCase()}.`
                        : 'A named pair of item order and box selection.'}
                        </p>
                        {!settings.auto && SPREADING_RULES.includes(settings.selection)
                        && boxSizesOffered(elements) > 1 && (
                        <p className="help is-warning">
                        With more than one box size on offer, the box with the most room left is
                        the largest one, every time. This rule is stated over boxes of one size;
                        here it buys container volume for nothing. For an even load ask for the
                        balanced goal instead.
                        </p>
                        )}
                        </div>
                        </div>

                        {advanced && (<>
                        {!settings.auto && (
                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">Item order</label>
                        <div className="select is-fullwidth">
                        <select value={settings.order} onChange={this.setSetting('order')}>
                        {(meta?.orders || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        </select>
                        </div>
                        <p className="help">
                        {(meta?.orders || []).find(o => o.value === settings.order)?.description || ''}
                        </p>
                        </div>
                        </div>
                        )}

                        {!settings.auto && (
                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">Box selection</label>
                        <div className="select is-fullwidth">
                        <select value={settings.selection} onChange={this.setSetting('selection')}>
                        {(meta?.selections || []).map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                        </select>
                        </div>
                        {(() => {
                        const rule = (meta?.selections || []).find(o => o.value === settings.selection)

                        if (!rule) {
                        return null
                        }

                        return (<>
                        <p className="help">{rule.description}</p>
                        <dl className="rule-facts">
                        {rule.bound && (<>
                        <dt>Worst case</dt>
                        <dd>{rule.bound}</dd>
                        </>)}
                        {rule.measured && (<>
                        <dt>Measured</dt>
                        <dd>{rule.measured}</dd>
                        </>)}
                        </dl>
                        </>)
                        })()}
                        </div>
                        </div>
                        )}

                        {settings.auto && (
                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">Goal</label>
                        <div className="select is-fullwidth">
                        <select value={settings.goal} onChange={this.setSetting('goal')}>
                        {(meta?.goals || []).map(g => (
                        <option key={g.value} value={g.value}>{g.label}</option>
                        ))}
                        </select>
                        </div>
                        <p className="help">
                        {(meta?.goals || []).find(g => g.value === settings.goal)?.description || ''}
                        </p>
                        </div>
                        </div>
                        )}

                        {!settings.auto && (
                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.search} onChange={this.toggleSetting('search')} />
                        {' '}Search
                        </label>
                        <p className="help">
                        The rules commit to the first sensible spot for each item. The search
                        instead carries several half-finished loads forward at once, fills the
                        emptiest corner of each with a stack of identical goods, and scores a
                        load by finishing it greedily. It costs three to five times the time:
                        measured on the Bischoff instances, it is worth about two points of
                        fill where an item may rest on nothing, and six where a load has to
                        stand up.
                        </p>
                        {settings.search && (
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.searchFills}
                        onChange={this.toggleSetting('searchFills')} />
                        {' '}Let the rule choose the box
                        </label>
                        )}
                        {settings.search && (
                        <p className="help">
                        The rule above picks which box to open and the search fills it, instead
                        of the search running the whole packing. It keeps the box count the
                        rule would have reached.
                        </p>
                        )}
                        </div>
                        </div>
                        )}

                        </>)}
                        </nav>

                        {advanced && (
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <strong><span className="glyph">⊞</span>Constraints</strong>
                        </p>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">Minimum support</label>
                        <input className="slider is-fullwidth is-small" type="range"
                        min="0" max="1" step="0.05"
                        value={settings.supportRatio}
                        onChange={this.setSetting('supportRatio', parseFloat)} />
                        <p className="help">
                        {settings.supportRatio === 0
                        ? 'Off: an item may rest on nothing.'
                        : `${Math.round(settings.supportRatio * 100)}% of an item's base must rest on what is below it.`}
                        </p>
                        </div>
                        </div>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.freeSpaceCorners}
                        onChange={this.toggleSetting('freeSpaceCorners')} />
                        {' '}Free space corners
                        </label>
                        <p className="help">
                        Offers each piece the corners of every empty space, not only the corners
                        of what is already placed, which finds cavities the ordinary points miss.
                        Measured on the Bischoff instances: worth 2.6 points of fill where an
                        item may rest on nothing, nothing at all under full support, for three
                        times the time.
                        </p>
                        </div>
                        </div>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="label is-small">How a placement is ranked</label>
                        <div className="select is-small is-fullwidth">
                        <select value={settings.merit} onChange={this.setSetting('merit')}>
                        {(meta?.merits || []).map(m => (
                        <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                        </select>
                        </div>
                        <p className="help">
                        {(meta?.merits || []).find(m => m.value === settings.merit)?.description || ''}
                        </p>
                        </div>
                        </div>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.rehome}
                        onChange={this.toggleSetting('rehome')} />
                        {' '}Move loads into smaller boxes
                        </label>
                        <p className="help">
                        Once everything is packed, each box's contents move into the smallest
                        kind that holds all of it. It never opens another box, and it pays off
                        for the rules that reach for the roomiest box they can see.
                        </p>
                        </div>
                        </div>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.balanceWeight}
                        onChange={this.toggleSetting('balanceWeight')} />
                        {' '}Even out the weight
                        </label>
                        <p className="help">
                        Moves items between the boxes afterwards so no one box is far heavier
                        than the rest.
                        </p>
                        </div>
                        </div>

                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={settings.singleContainer}
                        onChange={this.toggleSetting('singleContainer')} />
                        {' '}Fill one container
                        </label>
                        <p className="help">
                        Packs the first box as densely as it can and leaves the rest behind, even
                        dropping a bulky item to make room for several small ones.
                        </p>
                        </div>
                        </div>

                        </nav>
                        )}


                        {packResult && advanced && (
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <strong><span className="glyph">◈</span>Visualization</strong>
                        </p>
                        <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                        <label className="checkbox">
                        <input type="checkbox" checked={showAnimation} onChange={this.toggleAnimation} style={{ marginRight: '0.5rem' }} />
                        Show animation
                        </label>
                        </div>
                        </div>


                        </nav>
                        )}

                    </aside>

                    <div className="splitter is-vertical"
                        title="Drag to resize · double-click to collapse"
                        onPointerDown={event => this.startDrag(event, 'leftWidth', 1, PANE_SLOTS)}
                        onDblClick={() => this.setState(
                            state => ({ leftWidth: state.leftWidth > 0 ? 0 : 330 }),
                            () => this.resizeScene())}></div>

                    <main className="stage">
                        <div className="stage-scene" ref={node => this.mountScene(node)}></div>
                        {packResult && packResult.boxes && (packResult.boxes.some(box => box.items.length > 0)
                        || stagePanel === 'strategies') && (() => {
                        const filled = packResult.boxes.filter(box => box.items.length > 0)
                        const idle = packResult.boxes.length - filled.length
                        const shown = showEmptyBoxes ? packResult.boxes : filled

                        return (<>
                        <div className="splitter is-horizontal"
                        title="Drag to resize · double-click to collapse"
                        onPointerDown={event => this.startDrag(event, 'boxesHeight', -1, STRIP_SLOTS)}
                        onDblClick={() => this.setState(
                        state => ({ boxesHeight: state.boxesHeight > 0 ? 0 : 200 }),
                        () => this.resizeScene())}></div>
                        <nav className="panel" style={{ flex: `0 0 ${boxesHeight}px` }}>
                        <p className="panel-heading">
                        <span className="heading-row">
                        <span className="strip-tabs">
                        <button type="button" className={stagePanel === 'boxes' ? 'is-on' : ''}
                        onClick={() => this.setState({ stagePanel: 'boxes' })}>
                        <span className="glyph">▣</span>Containers ({filled.length})
                        </button>
                        <button type="button" className={stagePanel === 'strategies' ? 'is-on' : ''}
                        onClick={this.openStrategies}>
                        <span className="glyph">◆</span>Strategies
                        </button>
                        </span>
                        <span className="heading-tools">
                        {stagePanel === 'boxes' && idle > 0 && (
                        <button type="button"
                        className={showEmptyBoxes ? 'is-on' : ''}
                        onClick={this.toggleEmptyBoxes}
                        title="Show the boxes the packer left unused, here and in the scene">
                        {showEmptyBoxes ? `hide ${idle} unused` : `show ${idle} unused`}
                        </button>
                        )}
                        {stagePanel === 'boxes' && (<>
                        <button type="button" title="Previous (Ctrl+←)"
                        onClick={() => this.props.playground.selectPreviousBox()}>◀</button>
                        <button type="button" title="Next (Ctrl+→)"
                        onClick={() => this.props.playground.selectNextBox()}>▶</button>
                        </>)}
                        {stagePanel === 'strategies' && comparing && (
                        <span className="heading-note">running…</span>
                        )}
                        </span>
                        </span>
                        </p>
                        {stagePanel === 'strategies' && (
                        <div className="matrix-wrap">
                        {comparing && !comparison && (
                        <p className="strategy-empty">Trying every order against every rule…</p>
                        )}
                        {comparison && (() => {
                        const usable = comparison.filter(row => !row.failed)

                        if (usable.length === 0) {
                        return <p className="strategy-empty">No trial finished.</p>
                        }

                        const apart = row => row.selection === 'search' || Boolean(row.goal)
                        const plain = usable.filter(row => !apart(row))
                        const orders = [...new Set(plain.map(row => row.order))]
                        const rules = [...new Set(plain.map(row => row.selection))]
                        const leader = usable.slice().sort(compareOutcome)[0]
                        const singles = usable.filter(apart)

                        const ladder = usable.slice().sort(compareOutcome)
                        const place = new Map()
                        let rank = 0

                        ladder.forEach((row, at) => {
                        if (at === 0 || compareOutcome(row, ladder[at - 1]) !== 0) {
                        rank++
                        }

                        place.set(row, rank)
                        })

                        const cell = row => {
                        if (!row) {
                        return <span className="matrix-cell is-blank">—</span>
                        }

                        const mine = row.order === settings.order && row.selection === settings.selection
                        const best = compareOutcome(row, leader) === 0
                        const preview = outcomePreview(row.containers, 128, 46)
                        const classes = ['matrix-cell']
                        if (mine) classes.push('is-active')
                        if (best) classes.push('is-best')

                        return (
                        <button type="button" className={classes.join(' ')}
                        disabled={row.selection === 'search' && !row.goal}
                        title={row.selection === 'search'
                        ? 'The search is chosen under More settings'
                        : row.goal
                        ? `Pack for ${row.selection}: every rule is tried and the best answer kept`
                        : `Pack with ${row.selection}, ${row.order}`}
                        onClick={() => this.updateSettings(row.goal
                        ? { auto: true, search: false, goal: row.goal }
                        : {
                        order: row.order, selection: row.selection,
                        auto: false, search: false, parallel: false,
                        })}>
                        <svg className="matrix-view" viewBox={`-1 -1 ${preview.width + 2} ${preview.height + 2}`}
                        width="100%" height="46" preserveAspectRatio="xMidYMax meet">
                        {preview.boxes.map(box => (
                        <g key={box.key}>
                        <rect x={box.x} y={preview.height - box.height}
                        width={box.width} height={box.height} className="tile-box"/>
                        <rect x={box.x} y={preview.height - box.height * box.fill / 100}
                        width={box.width} height={box.height * box.fill / 100} className="tile-load"/>
                        </g>
                        ))}
                        </svg>
                        <span className="matrix-facts">
                        <span className="matrix-rank">{place.get(row)}</span>
                        <strong>{row.boxes}</strong>
                        {preview.hidden > 0 && `+${preview.hidden}`}
                        {' · '}{formatVolume(row.capacity)}
                        </span>
                        <span className="matrix-sub">
                        {row.fill < 10 ? row.fill.toFixed(1) : row.fill.toFixed(0)}% full
                        {' · '}{row.unfit > 0
                        ? <span className="is-alarm">
                        {Math.round(row.packed / (row.packed + row.unfit) * 100)}% packed,
                        {' '}{row.unfit} left
                        </span>
                        : 'all packed'}
                        </span>
                        <span className="matrix-sub">
                        {(row.micros / 1000).toFixed(row.micros < 10000 ? 1 : 0)} ms
                        {best && <span className="matrix-flag">best</span>}
                        {mine && <span className="matrix-flag is-current">in use</span>}
                        </span>
                        </button>
                        )
                        }

                        return (
                        <div className="matrix" style={{
                        gridTemplateColumns: `12rem repeat(${orders.length}, minmax(0, 1fr))`,
                        }}>
                        <span className="matrix-corner">rule \ order</span>
                        {orders.map(order => (
                        <span className="matrix-head" key={order}>{order}</span>
                        ))}

                        {rules.map(rule => (<>
                        <span className="matrix-rule" key={`name-${rule}`}
                        title={ruleNote(meta, rule)}>
                        <span className="matrix-rule-name">{rule}</span>
                        <span className="matrix-rule-gist">{ruleGist(meta, rule)}</span>
                        </span>
                        {orders.map(order => (
                        <span className="matrix-slot" key={`${rule}/${order}`}>
                        {cell(plain.find(row => row.selection === rule && row.order === order))}
                        </span>
                        ))}
                        </>))}

                        {singles.map(row => (
                        <React.Fragment key={`single-${row.selection}`}>
                        <span className="matrix-rule">{row.selection}</span>
                        <span className="matrix-slot">{cell(row)}</span>
                        {orders.slice(1).map(order => (
                        <span className="matrix-slot" key={`${row.selection}-${order}`}></span>
                        ))}
                        </React.Fragment>
                        ))}
                        </div>
                        )
                        })()}
                        {comparison && (
                        <p className="strategy-note">
                        One cell per trial, drawn to one scale. The number at the front is the
                        place this packing takes among all of them, ranked by goods left behind,
                        then the volume of container you pay for, then how many pieces of it.
                        Times are the fastest of three runs. A row that changes across the
                        columns is a rule the item order matters to; a row that does not is a
                        rule it makes no difference to. The rows below the matrix are not
                        rules: each tries every rule and keeps the answer its goal prefers,
                        so they cost more and can only match or beat the cells above. Click a
                        cell to pack with it.
                        </p>
                        )}
                        </div>
                        )}
                        {stagePanel === 'boxes' && (
                        <div className="box-list">
                        {shown.map((box, index) => {
                        const stats = this.calculateBoxStats(box)
                        const isSelected = selectedBox === box.id
                        const classes = ['box-card']
                        if (isSelected) classes.push('is-active')
                        if (stats.itemsCount === 0) classes.push('is-empty')

                        return (
                        <div key={box.id} className={classes.join(' ')}
                        onClick={() => this.selectBox(box.id)}>
                        <div className="box-card-head">
                        <span className="box-card-dims">
                        <span className="box-card-index">#{index + 1}</span>
                        {Math.round(box.width)}×{Math.round(box.height)}×{Math.round(box.depth)}
                        </span>
                        <span className="box-card-count">
                        {stats.itemsCount} {stats.itemsCount === 1 ? 'item' : 'items'}
                        </span>
                        </div>
                        <div className="box-card-meters">
                        {meterRow('vol', stats.utilization,
                        `${stats.usedVolume.toLocaleString()} of ${stats.totalVolume.toLocaleString()} mm³`, 'fill')}
                        {meterRow('wgt', stats.weightUtilization,
                        `${stats.grossWeight.toLocaleString()} of ${Math.round(box.weight).toLocaleString()} g gross`)}
                        </div>
                        </div>
                        )
                        })}
                        </div>
                        )}
                        </nav>
                        </>)
                        })()}

                    </main>

                    <div className="splitter is-vertical"
                        title="Drag to resize · double-click to collapse"
                        onPointerDown={event => this.startDrag(event, 'rightWidth', -1, PANE_SLOTS)}
                        onDblClick={() => this.setState(
                            state => ({ rightWidth: state.rightWidth > 0 ? 0 : 300 }),
                            () => this.resizeScene())}></div>

                    <aside className="pane pane-right">
                        {notice && (
                        <article className={`message ${notice.tone}`} style={{ flex: '0 0 auto' }}>
                        <div className="message-body">
                        {notice.text}
                        <button type="button" className="notice-close"
                        onClick={() => this.setState({ notice: null })}>dismiss</button>
                        </div>
                        </article>
                        )}

                        {requestError && (
                        <article className="message is-danger" style={{ flex: '0 0 auto' }}>
                        <div className="message-body">{requestError}</div>
                        </article>
                        )}

                        {packResult?.warning && (
                        <article className="message is-warning" style={{ flex: '0 0 auto' }}>
                        <div className="message-body">{packResult.warning}</div>
                        </article>
                        )}

                        {(() => {
                        const order = orderSummary(elements, packResult)

                        return (
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <strong><span className="glyph">≡</span>This order</strong>
                        </p>
                        <div className="details">
                        {order.pieces === 0 ? (
                        <p className="pane-empty">
                        Nothing to pack yet. Add {flat ? 'cuts' : 'goods'} on the left, then click a
                        container or a piece in the scene and its details appear here.
                        </p>
                        ) : (<>
                        <div className="stat-grid">
                        <span className="stat-card">
                        <span className="stat-label">{flat ? 'cuts' : 'goods'}</span>
                        <span className="stat-value">{order.pieces}</span>
                        <span className="stat-unit">
                        {order.kinds} {order.kinds === 1 ? 'kind' : 'kinds'}
                        </span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">weight</span>
                        <span className="stat-value">{formatWeight(order.weight)}</span>
                        <span className="stat-unit">as declared</span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">volume</span>
                        <span className="stat-value">{formatVolume(order.volume)}</span>
                        <span className="stat-unit">of goods</span>
                        </span>
                        </div>

                        <dl className="fact-list">
                        {order.containers > 0 && (<>
                        <dt>Packed into</dt>
                        <dd>
                        {order.containers} {order.containers === 1 ? 'container' : 'containers'}
                        {' · '}{formatVolume(order.capacity)} · {order.fill.toFixed(0)}% full
                        </dd>
                        </>)}
                        {order.left > 0 && (<>
                        <dt>Left behind</dt>
                        <dd className="is-alarm">{order.left}</dd>
                        </>)}
                        <dt>Containers offered</dt>
                        <dd>
                        {order.crateKinds} {order.crateKinds === 1 ? 'kind' : 'kinds'}
                        {order.dedicated > 0 && `, ${order.dedicated} dedicated`}
                        </dd>
                        {order.loadLimited > 0 && (<>
                        <dt>Load limits</dt>
                        <dd>{order.loadLimited} of {order.kinds} state what may rest on them</dd>
                        </>)}
                        {order.classes.length > 0 && (<>
                        <dt>Classes</dt>
                        <dd>
                        {order.classes.join(', ')}
                        {order.keptApart > 0 && ` · ${order.keptApart} kept apart`}
                        </dd>
                        </>)}
                        </dl>

                        {!selectedBoxData && (
                        <p className="pane-empty">
                        Click a container or a piece in the scene to see it here.
                        </p>
                        )}
                        </>)}
                        </div>
                        </nav>
                        )
                        })()}

                        {packResult && packResult.items && packResult.items.length > 0 && (
                        <nav className="panel" style={{ flex: '0 0 auto', border: '1px solid var(--alarm)' }}>
                        <p className="panel-heading" style={{ background: 'var(--surface-raised)', borderBottomColor: 'var(--alarm)' }}>
                        <strong><span className="glyph">⚠</span>Unfit ({packResult.items.length})</strong>
                        </p>
                        {packResult.items.map(item => (
                        <div key={item.id} className="panel-block" style={{ borderLeft: '2px solid var(--alarm)', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        <span className="dot" style={{
                        background: itemColorCss({ id: item.id, group: item.group }),
                        color: itemColorCss({ id: item.id, group: item.group }),
                        marginRight: '0.45rem',
                        }} />
                        <span style={{ flex: 1, color: 'var(--ink)' }}>
                        {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}
                        </span>
                        {item.group && (
                        <span className="tag is-dark is-small" style={{ marginLeft: '0.5rem' }}>{item.group}</span>
                        )}
                        {item.rotationBlocked ? (
                        <span className="tag is-warning is-small" style={{ marginLeft: '0.5rem' }}
                        title="Free to turn, this item fits. The rotation you set is what stops it.">
                        rotation blocks it
                        </span>
                        ) : item.unpackable && (
                        <span className="tag is-danger is-small" style={{ marginLeft: '0.5rem' }}
                        title="No box you offered could hold this item, even empty">
                        no box fits
                        </span>
                        )}
                        <span className="row-weight" style={{ marginLeft: '0.5rem' }}>
                        {formatWeight(item.weight)}
                        </span>
                        </div>
                        ))}
                        </nav>
                        )}
                        {selectedItemData && (() => {
                        const article = articleOf(articles, selectedItemData)
                        const laid = `${Math.round(selectedItemData.width)}×${Math.round(selectedItemData.height)}×${Math.round(selectedItemData.depth)}`
                        const turned = laid !== article.dims
                        const layer = layerOf(selectedBoxData, selectedItemData)
                        const above = coveredBy(selectedBoxData, selectedItemData)
                        const share = selectedBoxStats.totalVolume > 0
                        ? selectedItemData.width * selectedItemData.height * selectedItemData.depth
                        / selectedBoxStats.totalVolume * 100
                        : 0

                        return (
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <span className="heading-row">
                        <strong>
                        <span className="dot" style={{ background: article.color, color: article.color }} />
                        Piece {article.label}
                        </strong>
                        <span className="heading-tools">
                        <button type="button" onClick={() => this.selectBox(selectedBoxData.id)}
                        title="Back to the container">clear</button>
                        </span>
                        </span>
                        </p>
                        <div className="details">
                        <div className="stat-grid">
                        <span className="stat-card">
                        <span className="stat-label">as declared</span>
                        <span className="stat-value">{article.dims}</span>
                        <span className="stat-unit">millimetres</span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">as laid</span>
                        <span className="stat-value">{laid}</span>
                        <span className="stat-unit">
                        {turned ? 'turned to fit' : 'the way it came'}
                        </span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">weight</span>
                        <span className="stat-value">{formatWeight(selectedItemData.weight)}</span>
                        <span className="stat-unit">{share.toFixed(1)}% of the box</span>
                        </span>
                        </div>

                        <dl className="fact-list">
                        <dt>Corner at</dt>
                        <dd className="mono">
                        {Math.round(selectedItemData.position.x)} · {Math.round(selectedItemData.position.y)} · {Math.round(selectedItemData.position.z)} mm
                        </dd>
                        <dt>Layer</dt>
                        <dd>{layer.index} of {layer.total}, floor at {Math.round(selectedItemData.position.z)} mm</dd>
                        <dt>To reach it</dt>
                        <dd>{above.length === 0
                        ? 'nothing rests on it'
                        : `lift ${above.length} ${above.length === 1 ? 'piece' : 'pieces'} first`}</dd>
                        {(selectedItemData.nothingOnTop || selectedItemData.maxLoadOnTop > 0) && (<>
                        <dt>Carries</dt>
                        <dd>{selectedItemData.nothingOnTop
                        ? 'nothing may be stacked on it'
                        : `${formatWeight(loadOn(selectedBoxData, selectedItemData))} of ${formatWeight(selectedItemData.maxLoadOnTop)}`}</dd>
                        </>)}
                        {selectedItemData.separateFrom && selectedItemData.separateFrom.length > 0 && (<>
                        <dt>Kept from</dt>
                        <dd>{selectedItemData.separateFrom.join(', ')}</dd>
                        </>)}
                        {selectedItemData.group && (<>
                        <dt>Ships with</dt>
                        <dd>{selectedItemData.group}</dd>
                        </>)}
                        <dt>In container</dt>
                        <dd className="mono">
                        {Math.round(selectedBoxData.width)}×{Math.round(selectedBoxData.height)}×{Math.round(selectedBoxData.depth)}
                        </dd>
                        </dl>
                        </div>
                        </nav>
                        )
                        })()}

                        {selectedBoxData && selectedBoxStats && (
                        <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                        <strong><span className="glyph">≡</span>Container</strong>
                        </p>
                        <div className="details">
                        <div className="stat-grid">
                        <span className="stat-card">
                        <span className="stat-label">size</span>
                        <span className="stat-value">
                        {Math.round(selectedBoxData.width)}×{Math.round(selectedBoxData.height)}×{Math.round(selectedBoxData.depth)}
                        </span>
                        <span className="stat-unit">millimetres</span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">weight</span>
                        <span className="stat-value">{formatWeight(selectedBoxStats.grossWeight)}</span>
                        <span className="stat-unit">
                        of {formatWeight(selectedBoxData.weight)}
                        {selectedBoxStats.tare > 0 && ` · ${formatWeight(selectedBoxStats.tare)} tare`}
                        </span>
                        </span>
                        <span className="stat-card">
                        <span className="stat-label">items</span>
                        <span className="stat-value">{selectedBoxStats.itemsCount}</span>
                        <span className="stat-unit">{selectedBoxStats.utilization.toFixed(0)}% of the space</span>
                        </span>
                        </div>

                        <div className="box-card-meters">
                        {meterRow('vol', selectedBoxStats.utilization,
                        `${selectedBoxStats.usedVolume.toLocaleString()} of ${selectedBoxStats.totalVolume.toLocaleString()} mm³`, 'fill')}
                        {meterRow('wgt', selectedBoxStats.weightUtilization,
                        `${selectedBoxStats.grossWeight.toLocaleString()} of ${Math.round(selectedBoxData.weight).toLocaleString()} g gross`)}
                        </div>

                        {selectedBoxData.accepts && selectedBoxData.accepts.length > 0 && (
                        <dl className="fact-list">
                        <dt>Takes</dt>
                        <dd>{selectedBoxData.accepts.join(', ')} only</dd>
                        </dl>
                        )}

                        <div className="manifest">
                        <span className="stat-label">contents ({selectedBoxData.items.length})</span>
                        {selectedBoxData.items.map((item, idx) => (
                        <div key={item.id}
                        className={`manifest-row${selectedItem === item.id ? ' is-active' : ''}`}
                        onClick={() => this.selectItem(item.id)}
                        onDblClick={() => this.selectItem(item.id, true)}
                        title="Click to select · double-click to fly to it">
                        <span className="dot" style={{
                        background: itemColorCss(item),
                        color: itemColorCss(item),
                        }} />
                        <span className="manifest-index">{idx + 1}</span>
                        <span className="manifest-dims">
                        {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}
                        </span>
                        <span className="manifest-at" title="Position of the item's near-bottom-left corner">
                        @ {Math.round(item.position.x)} {Math.round(item.position.y)} {Math.round(item.position.z)}
                        </span>
                        <span className="row-weight">{formatWeight(item.weight)}</span>
                        </div>
                        ))}
                        </div>
                        </div>
                        </nav>
                        )}

                    </aside>
                </div>

                {printing && packResult && (
                    <div className="print-sheet">
                        <div className="print-toolbar">
                            <span className="print-title">{flat ? 'Cutting plan' : 'Loading plan'}</span>
                            <span style={{ flex: 1 }}></span>
                            <button type="button" className="button is-info is-small" onClick={() => window.print()}>Print</button>
                            <button type="button" className="button is-small" onClick={() => this.setState({ printing: false })}>Close</button>
                        </div>

                        <div className="print-body">
                            <div className="print-head">
                                <span className="print-doc">BoxPacker3 — {flat ? 'cutting plan' : 'loading plan'}</span>
                                <span className="print-meta">
                                    {summarise(packResult).boxes} {flat ? 'sheets' : 'containers'} · {summarise(packResult).packed} {flat ? 'pieces' : 'articles'}
                                    · {summarise(packResult).fill} full · {settings.order} / {settings.selection}
                                </span>
                            </div>

                            {(() => {
                                const plan = loadingPlan(packResult)

                                if (plan.length < 2) {
                                    return null
                                }

                                return (
                                    <section className="print-box print-manifest">
                                        <div className="print-box-head">
                                            <span className="print-box-dims">
                                                {plan.length} {flat ? 'sheets' : 'containers'} to load
                                            </span>
                                            <span style={{ flex: 1 }}></span>
                                            <span className="print-box-facts">
                                                one page each, in this order
                                            </span>
                                        </div>
                                        <table className="print-table">
                                            <thead>
                                                <tr>
                                                    <th className="num">No</th>
                                                    <th>Size</th>
                                                    <th className="num">Articles</th>
                                                    <th className="num">Full</th>
                                                    <th className="num">Gross</th>
                                                    <th>Limit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {plan.map(entry => (
                                                    <tr key={entry.id}>
                                                        <td className="num print-letter">{entry.number}</td>
                                                        <td className="mono">{entry.dims} mm</td>
                                                        <td className="mono num">{entry.count}</td>
                                                        <td className="mono num">{entry.fill}</td>
                                                        <td className="mono num">{entry.gross}</td>
                                                        <td className="mono ref">of {entry.limit}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </section>
                                )
                            })()}

                            {loadingPlan(packResult).map((sheetBox, sheetIndex, sheetAll) => (
                                <section className="print-box" key={sheetBox.id}>
                                    <div className="print-box-head">
                                        <span className="print-box-number">
                                            {sheetBox.number}{sheetAll.length > 1 ? ` / ${sheetAll.length}` : ''}
                                        </span>
                                        <span className="print-box-dims">{sheetBox.dims} mm</span>
                                        <span style={{ flex: 1 }}></span>
                                        <span className="print-box-facts">
                                            {sheetBox.count} {flat ? 'pieces' : 'articles'} · {sheetBox.fill} full · {sheetBox.gross} of {sheetBox.limit}
                                        </span>
                                    </div>

                                    <table className="print-table print-cargo">
                                        <thead>
                                            <tr>
                                                <th>Art</th>
                                                <th>Size as declared</th>
                                                <th>Unit</th>
                                                <th className="num">Qty</th>
                                                <th className="num">Total</th>
                                                <th>Notes</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cargoList(sheetBox.box, articles).map(row => (
                                                <tr key={row.label}>
                                                    <td className="ref">
                                                        <span className="print-dot" style={{ background: row.color }}></span>
                                                        <span className="print-letter">{row.label}</span>
                                                    </td>
                                                    <td className="mono">{row.dims} mm</td>
                                                    <td className="mono">{formatWeight(row.unit)}</td>
                                                    <td className="mono num">{row.count}</td>
                                                    <td className="mono num">{formatWeight(row.unit * row.count)}</td>
                                                    <td className="ref">{cargoNote(row)}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>

                                    {(() => {
                                        const cg = centreOfGravity(sheetBox.box)

                                        if (!cg) {
                                            return null
                                        }

                                        return (
                                            <div className={`print-balance${cg.balanced ? '' : ' is-off'}`}>
                                                <span className="print-balance-label">Centre of gravity</span>
                                                <span className="mono">
                                                    {Math.round(cg.x)} · {Math.round(cg.y)} · {Math.round(cg.z)} mm
                                                    ({Math.round(cg.shareX * 100)}% along the width,
                                                    {' '}{Math.round(cg.shareY * 100)}% along the height)
                                                </span>
                                                <span className="print-balance-verdict">
                                                    {cg.balanced ? 'within the middle third' : 'outside the middle third — check the load before sealing'}
                                                </span>
                                            </div>
                                        )
                                    })()}

                                    {!flat && (
                                        <div className="print-net">
                                            <div className="print-figure-title">
                                                The box opened out — the floor with its four walls folded flat
                                            </div>
                                            {(() => {
                                                const net = unfoldedNet(sheetBox.box, sheetBox.box.items, articles, 470)
                                                const pad = { left: 64, top: 22, right: 64, bottom: 46 }

                                                return (
                                                    <svg viewBox={`${-pad.left} ${-pad.top} ${net.width + pad.left + pad.right} ${net.height + pad.top + pad.bottom}`}
                                                        width="100%" style={{ maxWidth: `${net.width + pad.left + pad.right}px` }}>
                                                        {net.panels.map(panel => (
                                                            <g key={panel.key}>
                                                                <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h}
                                                                    fill="none" stroke="currentColor"
                                                                    strokeWidth={panel.key === 'floor' ? 1.6 : 1}
                                                                    strokeDasharray={panel.key === 'floor' ? '' : '5 3'}
                                                                    className="print-outline"/>
                                                                <clipPath id={`clip-${sheetBox.id}-${panel.key}`}>
                                                                    <rect x={panel.x} y={panel.y} width={panel.w} height={panel.h}/>
                                                                </clipPath>
                                                                <g clipPath={`url(#clip-${sheetBox.id}-${panel.key})`}>
                                                                    {panel.pieces.map(piece => (
                                                                        <g key={`${panel.key}-${piece.key}`}>
                                                                            <rect x={piece.x} y={piece.y}
                                                                                width={piece.w} height={piece.h}
                                                                                fill={piece.color} fillOpacity="0.26"
                                                                                stroke={piece.color} strokeWidth="0.9"/>
                                                                            {piece.w > 14 && piece.h > 12 && (
                                                                                <text x={piece.x + piece.w / 2}
                                                                                    y={piece.y + piece.h / 2 + 4}
                                                                                    textAnchor="middle"
                                                                                    className="print-piece-label">{piece.label}</text>
                                                                            )}
                                                                        </g>
                                                                    ))}
                                                                </g>
                                                                <text x={panel.labelX} y={panel.labelY}
                                                                    textAnchor={panel.anchor} className="print-axis">
                                                                    {panel.title}
                                                                </text>
                                                            </g>
                                                        ))}
                                                        <text x={-pad.left} y={net.height + 26} className="print-axis">
                                                            Floor {Math.round(sheetBox.box.width)} × {Math.round(sheetBox.box.height)} mm ·
                                                            {' '}walls {Math.round(sheetBox.box.depth)} mm high
                                                        </text>
                                                        <text x={-pad.left} y={net.height + 38} className="print-axis">
                                                            Each wall shows only what stands against it, seen from inside the box.
                                                        </text>
                                                    </svg>
                                                )
                                            })()}
                                        </div>
                                    )}

                                    <div className="print-origin">
                                        {flat
                                            ? 'Every measurement is in millimetres from the bottom-left corner of the sheet. Sizes are for the piece as laid out, after any turn.'
                                            : 'Stand at the open box. x runs left to right along the floor, y runs away from you into the box, and the layers stack upwards. Every measurement is in millimetres from the near-left corner of the floor. Work through the layers bottom first, following the numbers on each drawing.'}
                                    </div>

                                    {sheetBox.layers.map((layer, layerIndex) => (
                                        <div className="print-layer" key={layer.floor}>
                                            <div className="print-layer-head">
                                                {flat ? 'Cut plan' : `Layer ${layerIndex + 1} — floor at ${layer.floor} mm`}
                                            </div>
                                            <div className="print-figure">
                                                {(() => {
                                                    const box = sheetBox.box
                                                    const canvas = flat ? 560 : 500
                                                    const scale = canvas / box.width
                                                    const width = box.width * scale
                                                    const height = box.height * scale
                                                    const pieces = pieceBadges(planPieces(box, layer.items, articles, scale))
                                                    const ghosts = planPieces(box,
                                                        sheetBox.layers.slice(0, layerIndex).flatMap(l => l.items),
                                                        articles, scale)
                                                    const acrossTicks = rulerTicks(box.width, scale)
                                                    const upTicks = rulerTicks(box.height, scale)
                                                    const cg = layerIndex === 0 ? centreOfGravity(box) : null
                                                    const pad = { left: 46, top: 14, right: 34, bottom: 42 }

                                                    return (
                                                        <svg viewBox={`${-pad.left} ${-pad.top} ${width + pad.left + pad.right} ${height + pad.top + pad.bottom}`}
                                                            width="100%" style={{ maxWidth: `${width + pad.left + pad.right}px` }}>
                                                            {ghosts.map(ghost => (
                                                                <rect key={`ghost-${ghost.key}`} x={ghost.x} y={ghost.y}
                                                                    width={ghost.w} height={ghost.h} fill="none" stroke="currentColor"
                                                                    strokeWidth="0.7" strokeDasharray="3 3" className="print-ghost"/>
                                                            ))}

                                                            <rect x="0" y="0" width={width} height={height}
                                                                fill="none" stroke="currentColor" strokeWidth="1.6" className="print-outline"/>

                                                            {acrossTicks.map(tick => (
                                                                <g key={`x${tick.at}`}>
                                                                    <line x1={tick.pos} y1={height} x2={tick.pos} y2={height + 5}
                                                                        stroke="currentColor" strokeWidth="0.8" className="print-outline"/>
                                                                    <text x={tick.pos} y={height + 17} textAnchor="middle" className="print-axis">{tick.at}</text>
                                                                </g>
                                                            ))}
                                                            {upTicks.map(tick => (
                                                                <g key={`y${tick.at}`}>
                                                                    <line x1="-5" y1={height - tick.pos} x2="0" y2={height - tick.pos}
                                                                        stroke="currentColor" strokeWidth="0.8" className="print-outline"/>
                                                                    <text x="-9" y={height - tick.pos + 3} textAnchor="end" className="print-axis">{tick.at}</text>
                                                                </g>
                                                            ))}

                                                            {pieces.map(piece => (
                                                                <g key={piece.key}>
                                                                    <rect x={piece.x} y={piece.y} width={piece.w} height={piece.h}
                                                                        fill={piece.color} fillOpacity="0.28"
                                                                        stroke={piece.color} strokeWidth="1.2"/>
                                                                    {!piece.inside && (
                                                                        <line x1={piece.x + piece.w} y1={piece.y + piece.h / 2}
                                                                            x2={piece.bx - BADGE} y2={piece.by}
                                                                            stroke={piece.color} strokeWidth="0.8"/>
                                                                    )}
                                                                    <circle cx={piece.bx} cy={piece.by} r={BADGE}
                                                                        fill={piece.color} fillOpacity="0.92"
                                                                        stroke={piece.color} strokeWidth="1.1"/>
                                                                    <text x={piece.bx} y={piece.by + 4} textAnchor="middle" className="print-badge">
                                                                        {piece.step}
                                                                    </text>
                                                                    {piece.inside && piece.h > BADGE * 4.2 && (
                                                                        <text x={piece.bx} y={piece.by + BADGE + 13} textAnchor="middle" className="print-piece-label">
                                                                            {piece.label}
                                                                        </text>
                                                                    )}
                                                                </g>
                                                            ))}

                                                            {cg && (
                                                                <g className="print-cg">
                                                                    <line x1={cg.x * scale - 9} y1={height - cg.y * scale}
                                                                        x2={cg.x * scale + 9} y2={height - cg.y * scale} strokeWidth="1.2"/>
                                                                    <line x1={cg.x * scale} y1={height - cg.y * scale - 9}
                                                                        x2={cg.x * scale} y2={height - cg.y * scale + 9} strokeWidth="1.2"/>
                                                                    <circle cx={cg.x * scale} cy={height - cg.y * scale} r="5.5"
                                                                        fill="none" strokeWidth="1.2"/>
                                                                </g>
                                                            )}

                                                            <text x="0" y={height + 35} className="print-axis">
                                                                {flat ? 'Sheet' : 'Floor'} {Math.round(box.width)} across × {Math.round(box.height)} deep,
                                                                {' '}millimetres from the near-left corner, seen from above
                                                                {cg ? ' · the crosshair marks the centre of gravity' : ''}
                                                            </text>
                                                        </svg>
                                                    )
                                                })()}
                                            </div>

                                            <table className="print-table">
                                                <thead>
                                                    <tr>
                                                        <th>✓</th>
                                                        <th>#</th>
                                                        <th>Article</th>
                                                        <th>Corner at x · y</th>
                                                        <th>Size once laid</th>
                                                        <th>Weight</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {layer.items.map((item, step) => {
                                                        const article = articleOf(articles, item)
                                                        const turned = `${Math.round(item.width)}×${Math.round(item.height)}×${Math.round(item.depth)}` !== article.dims

                                                        return (
                                                            <tr key={item.id}>
                                                                <td className="tick"><span className="print-tick"></span></td>
                                                                <td className="num">{step + 1}</td>
                                                                <td className="ref">
                                                                    <span className="print-dot" style={{ background: article.color }}></span>
                                                                    <span className="print-letter">{article.label}</span>
                                                                    <span className="mono">{article.dims}</span>
                                                                    {article.group && <span className="print-group">{article.group}</span>}
                                                                </td>
                                                                <td className="mono">{Math.round(item.position.x)} · {Math.round(item.position.y)}</td>
                                                                <td className="mono">
                                                                    {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}
                                                                    {turned && <span className="print-turn">turned</span>}
                                                                </td>
                                                                <td className="mono">{formatWeight(item.weight)}</td>
                                                            </tr>
                                                        )
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))}
                                </section>
                            ))}

                            {packResult.items && packResult.items.length > 0 && (
                                <section className="print-box print-left">
                                    <div className="print-box-head">
                                        <span className="print-box-number">—</span>
                                        <span className="print-box-dims">Not loaded</span>
                                        <span style={{ flex: 1 }}></span>
                                        <span className="print-box-facts">{packResult.items.length} articles stay behind</span>
                                    </div>
                                    <table className="print-table">
                                        <tbody>
                                            {packResult.items.map(item => (
                                                <tr key={item.id}>
                                                    <td className="mono">{Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}</td>
                                                    <td className="mono">{formatWeight(item.weight)}</td>
                                                    <td className="ref">{item.rotationBlocked ? 'rotation locked' : (item.unpackable ? 'no box fits' : 'no room left')}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </section>
                            )}
                        </div>
                    </div>
                )}
            </div>
        );
    }
}

