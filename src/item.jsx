import React from 'react';
import {generateUUID} from "three/src/math/MathUtils.js";
import api from './api.js'

const datumValidate = /^(\d+);(\d+);(\d+);(\d+)$/
const boxType = 0
const itemType = 1

class Datum {
    constructor(id, type, width, height, depth, weight) {
        this.id = id
        this.type = type
        this.width = parseInt(width)
        this.height = parseInt(height)
        this.depth = parseInt(depth)
        this.weight = parseInt(weight)
        this.enabled = true
    }

    toString() {
        return this.width + 'x' + this.height + 'x' + this.depth + ' wg' + this.weight
    }

    toExport() {
        return [this.width, this.height, this.depth, this.weight, this.type].join(';')
    }
}

const STRATEGIES = [
    { value: 0, name: 'Minimize Boxes', description: 'Minimizes the number of boxes used. Sorts items by volume in descending order and uses First Fit algorithm to place each item in the first box where it fits' },
    { value: 1, name: 'Greedy', description: 'Greedy packing strategy (First Fit with ascending sort). Sorts items by volume in ascending order and uses First Fit algorithm. Simple and fast, but may use more boxes than optimal' },
    { value: 2, name: 'Best Fit', description: 'Best-fit strategy. For each item, finds the box with the smallest remaining space that can accommodate the item. Minimizes wasted space but requires checking all boxes for each item' },
    { value: 3, name: 'Best Fit Decreasing (BFD)', description: 'Best-fit decreasing strategy. Items sorted by volume in descending order, and for each item finds the box with the smallest remaining space. Typically provides 2-5% better space utilization' },
    { value: 4, name: 'Next Fit', description: 'Next-fit strategy. Items are placed in the current box if it fits, otherwise a new box is used. Simpler than First Fit but may use more boxes' },
    { value: 5, name: 'Worst Fit', description: 'Worst-fit strategy. For each item, finds the box with the largest remaining space that can accommodate the item. Helps distribute items more evenly across boxes' },
    { value: 6, name: 'Almost Worst Fit', description: 'Almost-worst-fit strategy. Similar to Worst Fit, but excludes boxes that are too large (almost empty). Prevents items from being placed in boxes that are nearly empty' },
];

export default class ItemComponent extends React.Component {
    state = {
        hasError: false,
        text: '',
        type: itemType,
        elements: [],
        packResult: null,
        selectedBox: null,
        showAnimation: true,
        animationSpeed: 1,
        strategy: 0,
    };

    constructor() {
        super(...arguments)
        this.renderTimeout = null;
        this.lastRenderElements = null;
    }

    async componentDidMount() {
        let { elements } = this.state;

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
            this.setState({ selectedBox: boxId });
        }

        await this.playgroundRender(elements)
        this.lastRenderElements = this.getElementsSnapshot(elements);
    }

    componentDidUpdate(prevProps, prevState) {
        const elementsChanged = prevState.elements !== this.state.elements;
        const strategyChanged = prevState.strategy !== this.state.strategy;
        const showAnimationChanged = prevState.showAnimation !== this.state.showAnimation;
        
        const elementsSnapshot = this.getElementsSnapshot(this.state.elements);
        const enabledStateChanged = this.lastRenderElements !== elementsSnapshot;
        
        if ((elementsChanged || strategyChanged || enabledStateChanged) && 
            this.state.elements.length > 0 &&
            this.state.elements.filter(e => e.enabled).length > 0) {
            
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
            .map(e => `${e.id}:${e.enabled}:${e.type}`)
            .sort()
            .join('|');
    }

    setText = e => {
        this.setState({ text: e.target.value });
    }
    setType = v => {
        this.setState({ type: v })
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
        let { elements, type, text } = this.state;
        const matchResult = text.match(datumValidate)

        if (matchResult === null) {
            this.setState({ hasError: true })
            return
        }

        const id = generateUUID()
        const datum = new Datum(id, type, matchResult[1], matchResult[2], matchResult[3], matchResult[4])

        this.setState({ 
            elements: elements.concat(datum), 
            text: '', 
            hasError: false 
        });
    }

    playgroundRender = async elements => {
        const items = elements.filter(e => e.enabled)

        this.props.playground.destroy();

        const requestData = {
                boxes: items.filter(i => i.type === boxType),
                items: items.filter(i => i.type === itemType),
        };

        if (this.state.strategy !== 0) {
            requestData.strategy = { value: this.state.strategy };
        }

        const packResult = await api('/bp3', requestData)

        this.setState({ packResult, selectedBox: null });

        this.props.playground.showAnimation = this.state.showAnimation;
        this.props.playground.animationSpeed = this.state.animationSpeed;

        this.props.playground.render(packResult)
    }

    setStrategy = (e) => {
        const strategy = parseInt(e.target.value);
        this.setState({ strategy });
    }

    selectBox = (boxId) => {
        this.props.playground.selectBox(boxId);
        this.setState({ selectedBox: boxId });
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
        const utilization = totalVolume > 0 ? (usedVolume / totalVolume * 100) : 0;
        const weightUtilization = box.weight > 0 ? (usedWeight / box.weight * 100) : 0;

        return {
            totalVolume: Math.round(totalVolume),
            usedVolume: Math.round(usedVolume),
            freeVolume: Math.round(totalVolume - usedVolume),
            utilization: Math.round(utilization * 10) / 10,
            usedWeight: Math.round(usedWeight),
            weightUtilization: Math.round(weightUtilization * 10) / 10,
            itemsCount: box.items.length
        };
    }

    onImport = () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.style.display = 'none';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) {
                return;
            }

            try {
                const text = await file.text();
                const lines = text.split('\n').filter(line => line.trim());
                
                if (lines.length === 0) {
                    alert('File is empty');
                    return;
                }

                let startIndex = 0;
                const firstLine = lines[0].trim().toLowerCase();
                if (firstLine.includes('width') || firstLine.includes('height') || 
                    firstLine.includes('type') || firstLine.includes('id') ||
                    firstLine.includes('depth') || firstLine.includes('weight')) {
                    startIndex = 1;
                }
                
                const importedElements = [];
                const errors = [];
                
                for (let i = startIndex; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (!line || line.startsWith('#')) continue;
                    
                    const parts = line.split(/[;,\t]/).map(p => p.trim()).filter(p => p);
                    
                    if (parts.length < 4) {
                        errors.push(`Line ${i + 1}: insufficient data (expected at least 4 fields: width, height, depth, weight)`);
                        continue;
                    }

                    let widthNum, heightNum, depthNum, weightNum, typeNum;
                    
                    if (parts.length === 5) {
                        [widthNum, heightNum, depthNum, weightNum, typeNum] = parts.map(p => parseInt(p));
                    } else if (parts.length === 6) {
                        const [id, width, type, height, depth, weight] = parts;
                        widthNum = parseInt(width);
                        heightNum = parseInt(height);
                        depthNum = parseInt(depth);
                        weightNum = parseInt(weight);
                        typeNum = parseInt(type);
                    } else {
                        const firstNum = parseInt(parts[0]);
                        if (firstNum === 0 || firstNum === 1) {
                            [typeNum, widthNum, heightNum, depthNum, weightNum] = parts.map(p => parseInt(p));
                        } else {
                            [widthNum, heightNum, depthNum, weightNum] = parts.map(p => parseInt(p));
                            typeNum = itemType;
                        }
                    }
                    if (isNaN(widthNum) || isNaN(heightNum) || isNaN(depthNum) || isNaN(weightNum)) {
                        errors.push(`Line ${i + 1}: invalid data format (expected numbers)`);
                        continue;
                    }

                    if (widthNum <= 0 || heightNum <= 0 || depthNum <= 0 || weightNum <= 0) {
                        errors.push(`Line ${i + 1}: dimensions and weight must be positive`);
                        continue;
                    }

                    if (typeNum === undefined || isNaN(typeNum)) {
                        typeNum = itemType;
                    } else if (typeNum !== boxType && typeNum !== itemType) {
                        errors.push(`Line ${i + 1}: invalid type (must be 0 for boxes or 1 for items)`);
                        continue;
                    }

                    const elementId = generateUUID();
                    
                    importedElements.push(new Datum(
                        elementId,
                        typeNum,
                        widthNum,
                        heightNum,
                        depthNum,
                        weightNum
                    ));
                }

                if (importedElements.length === 0) {
                    alert('Failed to import elements. Please check the file format.\n\nErrors:\n' + errors.join('\n'));
                    return;
                }

                if (this.renderTimeout) {
                    clearTimeout(this.renderTimeout);
                    this.renderTimeout = null;
                }

                this.setState({ 
                    elements: importedElements,
                    packResult: null,
                    selectedBox: null
                }, () => {
                    this.playgroundRender(importedElements);
                    this.lastRenderElements = this.getElementsSnapshot(importedElements);
                });
                let message = `Imported elements: ${importedElements.length}`;
                const boxesCount = importedElements.filter(e => e.type === boxType).length;
                const itemsCount = importedElements.filter(e => e.type === itemType).length;
                message += `\nBoxes: ${boxesCount}, Items: ${itemsCount}`;
                
                if (errors.length > 0) {
                    message += `\nErrors: ${errors.length}`;
                }
                
                if (errors.length > 0 && errors.length <= 5) {
                    message += '\n\nErrors:\n' + errors.join('\n');
                }
                
                alert(message);

            } catch (error) {
                alert('Error reading file: ' + error.message);
            } finally {
                if (input.parentNode) {
                    document.body.removeChild(input);
                }
            }
        };

        document.body.appendChild(input);
        input.click();
    }

    onExport = () => {
        const { elements } = this.state;
        
        if (elements.length === 0) {
            alert('No elements to export');
            return;
        }

        const exportAll = confirm('Export all elements? (Cancel - only enabled)');
        
        const elementsToExport = exportAll 
            ? elements 
            : elements.filter(e => e.enabled);

        if (elementsToExport.length === 0) {
            alert('No elements to export');
            return;
        }

        const csvContent = "data:text/csv;charset=utf-8,"
            + elementsToExport.map(e => e.toExport()).join("\n")

        const link = document.createElement("a")
        link.setAttribute("href", encodeURI(csvContent))
        link.setAttribute("download", `boxpacker3-export-${new Date().toISOString().split('T')[0]}.csv`)
        link.click()
    }

    render({ }, { elements, type, text, hasError, packResult, selectedBox, showAnimation, animationSpeed, strategy }) {
        const selectedBoxData = packResult && selectedBox 
            ? packResult.boxes.find(b => b.id === selectedBox)
            : null;
        const selectedBoxStats = selectedBoxData ? this.calculateBoxStats(selectedBoxData) : null;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100vh', overflowY: 'auto', margin: 0, padding: 0 }}>
                <nav className="panel" style={{ flex: '0 0 auto' }}>
                <p className="panel-heading field">
                    <div className="level">
                        <div className="level-left">
                            <div className="level-item">
                                <p className="subtitle is-5" style={{ margin: 0, fontSize: '0.875rem', color: '#ffffff', fontWeight: 700 }}>
                                    <strong style={{ color: '#ffffff' }}>Settings</strong>
                                </p>
                            </div>
                        </div>
                        <div className="level-right">
                            <div className="level-item">
                                <div className="field has-addons">
                                    <p className="control">
                                        <a href="#" onClick={this.onImport} className="button is-info is-small" title="Import CSV file">
                                            Import
                                        </a>
                                    </p>
                                    <p className="control">
                                        <a href="#" onClick={this.onExport} className="button is-success is-small" title="Export to CSV">
                                            Export
                                        </a>
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </p>
                <form onSubmit={this.addElement} action="javascript:">
                    <div className="panel-block">
                        <p className="control has-icons-right">
                            <input value={text} onInput={this.setText}
                                   className="input is-primary" type="text" placeholder="w;h;d;wg" />
                            {hasError &&
                                <p className="help is-danger">Incorrect syntax</p>
                            }
                        </p>
                    </div>
                    <p className="panel-tabs">
                        <a href="#" className={type === boxType ? "is-active" : ""} onClick={() => this.setType(boxType)}>Boxes</a>
                        <a href="#" className={type === itemType ? "is-active" : ""} onClick={() => this.setType(itemType)}>Items</a>
                    </p>
                </form>
                { elements.filter(datum => datum.type === type).length === 0 ? (
                    <div className="panel-block" style={{ textAlign: 'center', padding: '1.5rem', color: '#bbb', fontSize: '0.75rem' }}>
                        <p>No {type === boxType ? 'boxes' : 'items'}</p>
                    </div>
                ) : (
                    elements.filter(datum => datum.type === type).map(datum => (
                        <label key={datum.id} className="panel-block" style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', alignItems: 'center' }}>
                            <input type="checkbox" checked={datum.enabled} onChange={() => this.switchEnabled(datum.id)} style={{ marginRight: '0.75rem' }} />
                            <span style={{ flex: 1, fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                        {datum.toString()}
                            </span>
                            {!datum.enabled && <span className="tag is-light" style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>OFF</span>}
                    </label>
                    ))
                )}
            </nav>

                <nav className="panel" style={{ flex: '0 0 auto' }}>
                    <p className="panel-heading">
                        <strong>Strategy</strong>
                    </p>
                    <div className="panel-block">
                        <div className="field" style={{ width: '100%' }}>
                            <label className="label is-small">Strategy</label>
                            <div className="select is-fullwidth">
                                <select value={strategy} onChange={this.setStrategy}>
                                    {STRATEGIES.map(s => (
                                        <option key={s.value} value={s.value}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <p className="help">
                                {STRATEGIES.find(s => s.value === strategy)?.description || ''}
                            </p>
                        </div>
                    </div>
                </nav>

                {packResult && (
                    <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                            <strong>Visualization</strong>
                        </p>
                        <div className="panel-block">
                            <div className="field" style={{ width: '100%' }}>
                                <label className="checkbox">
                                    <input type="checkbox" checked={showAnimation} onChange={this.toggleAnimation} style={{ marginRight: '0.5rem' }} />
                                    Show animation
                                </label>
                            </div>
                        </div>
                        {showAnimation && (
                            <div className="panel-block">
                                <div className="field" style={{ width: '100%' }}>
                                    <label className="label is-small">Animation Speed</label>
                                    <input 
                                        className="slider is-fullwidth is-small" 
                                        step="0.1" 
                                        min="0.1" 
                                        max="3" 
                                        type="range" 
                                        value={animationSpeed} 
                                        onChange={this.setAnimationSpeed}
                                    />
                                    <p className="help">{animationSpeed.toFixed(1)}x</p>
                                </div>
                            </div>
                        )}
                        {packResult.executionTime !== undefined && (
                            <div className="panel-block" style={{ background: '#1a1a1a', border: '1px solid #333', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                <div className="level is-mobile" style={{ margin: 0, width: '100%' }}>
                                    <div className="level-left">
                                        <div className="level-item">
                                            <span style={{ color: '#888' }}>Execution time:</span>
                                        </div>
                                    </div>
                                    <div className="level-right">
                                        <div className="level-item">
                                            <span style={{ color: '#4a9eff', fontWeight: 600 }}>{packResult.executionTime} ms</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="panel-block" style={{ background: '#2a2a2a', border: '1px solid #333', fontSize: '0.75rem', color: '#bbb' }}>
                            <p className="help" style={{ margin: 0 }}>
                                Click boxes in 3D or list to view details | Ctrl+←/→ to navigate
                            </p>
                        </div>
                    </nav>
                )}

                {packResult && packResult.boxes && packResult.boxes.length > 0 && (
                    <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                            <div className="level" style={{ margin: 0 }}>
                                <div className="level-left">
                                    <div className="level-item">
                                        <strong>Boxes ({packResult.boxes.length})</strong>
                                    </div>
                                </div>
                                <div className="level-right">
                                    <div className="level-item">
                                        <div className="field has-addons">
                                            <p className="control">
                                                <button 
                                                    className="button is-small is-info" 
                                                    onClick={() => this.props.playground.selectPreviousBox()}
                                                    title="Previous (Ctrl+←)"
                                                    style={{ minWidth: '2rem', padding: '0.25rem 0.5rem' }}
                                                >
                                                    ◀
                                                </button>
                                            </p>
                                            <p className="control">
                                                <button 
                                                    className="button is-small is-info" 
                                                    onClick={() => this.props.playground.selectNextBox()}
                                                    title="Next (Ctrl+→)"
                                                    style={{ minWidth: '2rem', padding: '0.25rem 0.5rem' }}
                                                >
                                                    ▶
                                                </button>
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </p>
                        {packResult.boxes.map((box, index) => {
                            const stats = this.calculateBoxStats(box);
                            const isSelected = selectedBox === box.id;
                            return (
                                <a 
                                    key={box.id} 
                                    href="#" 
                                    className={`panel-block ${isSelected ? 'is-active' : ''}`}
                                    onClick={(e) => { e.preventDefault(); this.selectBox(box.id); }}
                                >
                                    <div style={{ width: '100%' }}>
                                        <div className="level is-mobile" style={{ marginBottom: '0.5rem' }}>
                                            <div className="level-left">
                                                <div className="level-item" style={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                                    <strong>#{index + 1}</strong>
                                                    <span style={{ marginLeft: '1rem', color: '#888' }}>|</span>
                                                    <span style={{ marginLeft: '0.75rem' }}>{Math.round(box.width)}×{Math.round(box.height)}×{Math.round(box.depth)}</span>
                                                    {isSelected && <span className="tag is-success" style={{ marginLeft: '0.5rem', fontSize: '0.7rem' }}>ACTIVE</span>}
                                                </div>
                                            </div>
                                            <div className="level-right">
                                                <div className="level-item">
                                                    <span className="tag is-info" style={{ fontSize: '0.7rem' }}>{stats.itemsCount}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>
                                            <div style={{ marginBottom: '0.5rem' }}>
                                                <div className="level is-mobile" style={{ marginBottom: '0.25rem' }}>
                                                    <div className="level-left">
                                                        <span style={{ color: '#bbb' }}>VOL</span>
                                                    </div>
                                                    <div className="level-right">
                                                        <span style={{ color: stats.utilization > 80 ? '#f14668' : stats.utilization > 60 ? '#ffa726' : '#48c774', fontWeight: 600 }}>
                                                            {stats.utilization.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </div>
                                                <progress 
                                                    className="progress" 
                                                    value={stats.utilization} 
                                                    max="100"
                                                    style={{ marginBottom: '0.25rem', height: '3px' }}
                                                />
                                                <div style={{ color: '#bbb', fontSize: '0.7rem' }}>
                                                    {stats.usedVolume.toLocaleString()}/{stats.totalVolume.toLocaleString()} mm³
                                                </div>
                                            </div>
                                            <div>
                                                <div className="level is-mobile" style={{ marginBottom: '0.25rem' }}>
                                                    <div className="level-left">
                                                        <span style={{ color: '#bbb' }}>WGT</span>
                                                    </div>
                                                    <div className="level-right">
                                                        <span style={{ color: stats.weightUtilization > 80 ? '#f14668' : stats.weightUtilization > 60 ? '#ffa726' : '#48c774', fontWeight: 600 }}>
                                                            {stats.weightUtilization.toFixed(1)}%
                                                        </span>
                                                    </div>
                                                </div>
                                                <progress 
                                                    className="progress" 
                                                    value={stats.weightUtilization} 
                                                    max="100"
                                                    style={{ height: '3px', marginBottom: '0.25rem' }}
                                                />
                                                <div style={{ color: '#bbb', fontSize: '0.7rem' }}>
                                                    {stats.usedWeight.toLocaleString()}/{Math.round(box.weight).toLocaleString()} g
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </a>
                            );
                        })}
                    </nav>
                )}

                {selectedBoxData && selectedBoxStats && (
                    <nav className="panel" style={{ flex: '0 0 auto' }}>
                        <p className="panel-heading">
                            <strong>Details</strong>
                        </p>
                        <div className="panel-block" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '1rem' }}>
                                <div style={{ fontFamily: 'monospace', fontSize: '0.8125rem', marginBottom: '1rem' }}>
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <span style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase' }}>Size</span>
                                    <div style={{ color: '#f0f0f0', marginTop: '0.25rem' }}>
                                        {Math.round(selectedBoxData.width)} × {Math.round(selectedBoxData.height)} × {Math.round(selectedBoxData.depth)} mm
                                    </div>
                                </div>
                                <div style={{ marginBottom: '0.5rem' }}>
                                    <span style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase' }}>Max Weight</span>
                                    <div style={{ color: '#f0f0f0', marginTop: '0.25rem' }}>
                                        {Math.round(selectedBoxData.weight).toLocaleString()} g
                                    </div>
                                </div>
                                <div>
                                    <span style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase' }}>Items</span>
                                    <div style={{ color: '#f0f0f0', marginTop: '0.25rem' }}>
                                        {selectedBoxStats.itemsCount}
                                    </div>
                                </div>
                            </div>
                            
                            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem', marginTop: '1rem' }}>
                                <div style={{ marginBottom: '1rem' }}>
                                    <div className="level is-mobile" style={{ marginBottom: '0.5rem' }}>
                                        <div className="level-left">
                                            <span style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase' }}>Volume</span>
                                        </div>
                                        <div className="level-right">
                                            <span style={{ color: selectedBoxStats.utilization > 80 ? '#f14668' : selectedBoxStats.utilization > 60 ? '#ffa726' : '#48c774', fontFamily: 'monospace', fontWeight: 600 }}>
                                                {selectedBoxStats.utilization.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                    <progress className="progress" value={selectedBoxStats.utilization} max="100" style={{ height: '3px', marginBottom: '0.5rem' }} />
                                    <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#bbb' }}>
                                        {selectedBoxStats.usedVolume.toLocaleString()} / {selectedBoxStats.totalVolume.toLocaleString()} mm³
                                        <br />
                                        Free: {selectedBoxStats.freeVolume.toLocaleString()} mm³
                                    </div>
                                </div>
                                
                                <div>
                                    <div className="level is-mobile" style={{ marginBottom: '0.5rem' }}>
                                        <div className="level-left">
                                            <span style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase' }}>Weight</span>
                                        </div>
                                        <div className="level-right">
                                            <span style={{ color: selectedBoxStats.weightUtilization > 80 ? '#f14668' : selectedBoxStats.weightUtilization > 60 ? '#ffa726' : '#48c774', fontFamily: 'monospace', fontWeight: 600 }}>
                                                {selectedBoxStats.weightUtilization.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                    <progress className="progress" value={selectedBoxStats.weightUtilization} max="100" style={{ height: '3px', marginBottom: '0.5rem' }} />
                                    <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#bbb' }}>
                                        {selectedBoxStats.usedWeight.toLocaleString()} / {Math.round(selectedBoxData.weight).toLocaleString()} g
                                    </div>
                                </div>
                            </div>
                            
                            <div style={{ borderTop: '1px solid #333', paddingTop: '1rem', marginTop: '1rem' }}>
                                <div style={{ color: '#bbb', fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '0.75rem' }}>
                                    Items ({selectedBoxData.items.length})
                                </div>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    {selectedBoxData.items.map((item, idx) => (
                                        <div key={item.id} className="box" style={{ marginBottom: '0.5rem' }}>
                                            <div className="level is-mobile" style={{ marginBottom: '0.25rem' }}>
                                                <div className="level-left">
                                                    <span style={{ color: '#4a9eff', fontFamily: 'monospace' }}>#{idx + 1}</span>
                                                    <span style={{ marginLeft: '0.5rem', fontFamily: 'monospace' }}>
                                                        {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}
                                                    </span>
                                                </div>
                                                <div className="level-right">
                                                    <span style={{ color: '#bbb', fontFamily: 'monospace', fontSize: '0.7rem' }}>
                                                        {Math.round(item.weight)}g
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: '#999' }}>
                                                ({Math.round(item.position.x)}, {Math.round(item.position.y)}, {Math.round(item.position.z)})
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </nav>
                )}

                {packResult && packResult.items && packResult.items.length > 0 && (
                    <nav className="panel" style={{ flex: '0 0 auto', border: '1px solid #f14668' }}>
                        <p className="panel-heading" style={{ background: '#2a1a1a', borderBottomColor: '#f14668' }}>
                            <strong>Unfit ({packResult.items.length})</strong>
                        </p>
                        {packResult.items.map(item => (
                            <div key={item.id} className="panel-block" style={{ borderLeft: '2px solid #f14668', fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                <span style={{ flex: 1, color: '#f0f0f0' }}>
                                    {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)}
                                </span>
                                <span style={{ color: '#bbb', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                                    {Math.round(item.weight)}g
                                </span>
                            </div>
                        ))}
                    </nav>
                )}
            </div>
        );
    }
}

