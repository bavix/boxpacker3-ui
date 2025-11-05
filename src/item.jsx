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
        return [this.id, this.width, this.type, this.height, this.depth, this.weight].join(';')
    }
}

// Packing strategies (matching boxpacker3 constants)
const STRATEGIES = [
    { value: 0, name: 'Minimize Boxes', description: 'Minimizes the number of boxes used' },
    { value: 1, name: 'Greedy', description: 'First-fit strategy with ascending item order' },
    { value: 2, name: 'First Fit Decreasing (FFD)', description: 'First-fit decreasing strategy' },
    { value: 3, name: 'Best Fit', description: 'Best-fit strategy' },
    { value: 4, name: 'Best Fit Decreasing (BFD)', description: 'Best-fit decreasing strategy' },
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
        strategy: 0, // Default: Minimize Boxes
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

        // Setup box selection callback
        this.props.playground.onBoxSelect = (boxId) => {
            this.setState({ selectedBox: boxId });
        }

        await this.playgroundRender(elements)
        this.lastRenderElements = this.getElementsSnapshot(elements);
    }

    componentDidUpdate(prevProps, prevState) {
        // Auto-recalculate when elements, strategy, or animation settings change
        const elementsChanged = prevState.elements !== this.state.elements;
        const strategyChanged = prevState.strategy !== this.state.strategy;
        const showAnimationChanged = prevState.showAnimation !== this.state.showAnimation;
        
        // Check if enabled state of elements changed
        const elementsSnapshot = this.getElementsSnapshot(this.state.elements);
        const enabledStateChanged = this.lastRenderElements !== elementsSnapshot;
        
        // Only re-render if there are actual changes and we have elements
        if ((elementsChanged || strategyChanged || enabledStateChanged) && 
            this.state.elements.length > 0 &&
            this.state.elements.filter(e => e.enabled).length > 0) {
            
            // Debounce rapid updates
            if (this.renderTimeout) {
                clearTimeout(this.renderTimeout);
            }
            
            this.renderTimeout = setTimeout(() => {
                this.playgroundRender(this.state.elements);
                this.lastRenderElements = this.getElementsSnapshot(this.state.elements);
            }, 300); // 300ms debounce
        }
    }

    componentWillUnmount() {
        // Cleanup timeout on unmount
        if (this.renderTimeout) {
            clearTimeout(this.renderTimeout);
        }
    }

    getElementsSnapshot(elements) {
        // Create a snapshot string for enabled elements to detect changes
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
            // Create new array to trigger React update
            this.setState({ elements: [...elements] })
            // ComponentDidUpdate will handle the re-render
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
        // ComponentDidUpdate will handle the re-render
    }

    playgroundRender = async elements => {
        const items = elements.filter(e => e.enabled)
        
        // Clear visualization first
        this.props.playground.destroy();

        const requestData = {
            boxes: items.filter(i => i.type === boxType),
            items: items.filter(i => i.type === itemType),
        };

        // Add strategy if not default
        if (this.state.strategy !== 0) {
            requestData.strategy = { value: this.state.strategy };
        }

        const packResult = await api('/bp3', requestData)

        this.setState({ packResult, selectedBox: null });

        // Update animation settings
        this.props.playground.showAnimation = this.state.showAnimation;
        this.props.playground.animationSpeed = this.state.animationSpeed;

        this.props.playground.render(packResult)
    }

    setStrategy = (e) => {
        const strategy = parseInt(e.target.value);
        this.setState({ strategy });
        // ComponentDidUpdate will handle the re-render
    }

    selectBox = (boxId) => {
        this.props.playground.selectBox(boxId);
        this.setState({ selectedBox: boxId });
    }

    toggleAnimation = () => {
        const newValue = !this.state.showAnimation;
        this.setState({ showAnimation: newValue });
        this.props.playground.showAnimation = newValue;
        // ComponentDidUpdate will handle the re-render
    }

    setAnimationSpeed = (e) => {
        const speed = parseFloat(e.target.value);
        this.setState({ animationSpeed: speed });
        this.props.playground.animationSpeed = speed;
        // ComponentDidUpdate will handle the re-render if needed
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
        // Create file input element
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

                // Skip header if present (check for common header patterns)
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
                    if (!line || line.startsWith('#')) continue; // Skip empty lines and comments
                    
                    const parts = line.split(/[;,\t]/).map(p => p.trim()).filter(p => p);
                    
                    // Support both formats:
                    // Old: id;width;type;height;depth;weight (6 fields)
                    // New: width;height;depth;weight;type (5 fields) or type;width;height;depth;weight
                    if (parts.length < 4) {
                        errors.push(`Line ${i + 1}: insufficient data (expected at least 4 fields: width, height, depth, weight)`);
                        continue;
                    }

                    let widthNum, heightNum, depthNum, weightNum, typeNum;
                    
                    if (parts.length === 5) {
                        // New simplified format: width;height;depth;weight;type
                        [widthNum, heightNum, depthNum, weightNum, typeNum] = parts.map(p => parseInt(p));
                    } else if (parts.length === 6) {
                        // Old format: id;width;type;height;depth;weight
                        const [id, width, type, height, depth, weight] = parts;
                        widthNum = parseInt(width);
                        heightNum = parseInt(height);
                        depthNum = parseInt(depth);
                        weightNum = parseInt(weight);
                        typeNum = parseInt(type);
                    } else {
                        // Try to auto-detect: assume first number is type if it's 0 or 1
                        const firstNum = parseInt(parts[0]);
                        if (firstNum === 0 || firstNum === 1) {
                            // Format: type;width;height;depth;weight
                            [typeNum, widthNum, heightNum, depthNum, weightNum] = parts.map(p => parseInt(p));
                        } else {
                            // Format: width;height;depth;weight (type defaults to itemType)
                            [widthNum, heightNum, depthNum, weightNum] = parts.map(p => parseInt(p));
                            typeNum = itemType; // Default to item if type not specified
                        }
                    }

                    // Validate data
                    if (isNaN(widthNum) || isNaN(heightNum) || isNaN(depthNum) || isNaN(weightNum)) {
                        errors.push(`Line ${i + 1}: invalid data format (expected numbers)`);
                        continue;
                    }

                    if (widthNum <= 0 || heightNum <= 0 || depthNum <= 0 || weightNum <= 0) {
                        errors.push(`Line ${i + 1}: dimensions and weight must be positive`);
                        continue;
                    }

                    if (typeNum === undefined || isNaN(typeNum)) {
                        typeNum = itemType; // Default to item
                    } else if (typeNum !== boxType && typeNum !== itemType) {
                        errors.push(`Line ${i + 1}: invalid type (must be 0 for boxes or 1 for items)`);
                        continue;
                    }

                    // Generate ID automatically
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

                // Clear any pending renders
                if (this.renderTimeout) {
                    clearTimeout(this.renderTimeout);
                    this.renderTimeout = null;
                }

                // Replace all existing elements with imported ones (full cleanup)
                // This includes boxes loaded from /bp3boxes endpoint
                this.setState({ 
                    elements: importedElements,
                    packResult: null, // Clear previous packing results
                    selectedBox: null // Clear selection
                }, () => {
                    // Immediate render after import (no debounce)
                    this.playgroundRender(importedElements);
                    this.lastRenderElements = this.getElementsSnapshot(importedElements);
                });

                // Show import result
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
                // Clean up
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

        // Show confirmation dialog for export options
        const exportAll = confirm('Export all elements? (Cancel - only enabled)');
        
        const elementsToExport = exportAll 
            ? elements 
            : elements.filter(e => e.enabled);

        if (elementsToExport.length === 0) {
            alert('No elements to export');
            return;
        }

        const csvContent = "data:text/csv;charset=utf-8,"
            + "id;width;type;height;depth;weight\n"
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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflowY: 'auto' }}>
                <nav className="panel" style={{ flex: '0 0 auto' }}>
                <p className="panel-heading field">
                    <div className="level">
                        <div className="level-left">
                            <div className="level-item">
                                <p className="subtitle is-5">
                                    <strong>Settings</strong>
                                </p>
                            </div>
                        </div>
                        <div className="level-right">
                            <div className="level-item">
                                <div className="field has-addons">
                                    <p className="control">
                                        <a href="#" onClick={this.onImport} className="button is-info is-light is-small is-rounded">import</a>
                                    </p>
                                    <p className="control">
                                        <a href="#" onClick={this.onExport} className="button is-success is-light is-small is-rounded">export</a>
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
                { elements.filter(datum => datum.type === type).map(datum => (
                    <label key={datum.id} className="panel-block">
                        <input type="checkbox" checked={datum.enabled} onChange={() => this.switchEnabled(datum.id)} />
                        {datum.toString()}
                    </label>
                ))}
            </nav>

                <nav className="panel" style={{ flex: '0 0 auto', marginTop: '0.5rem' }}>
                    <p className="panel-heading">
                        <strong>Packing Strategy</strong>
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
                    <nav className="panel" style={{ flex: '0 0 auto', marginTop: '0.5rem' }}>
                        <p className="panel-heading">
                            <strong>Visualization</strong>
                        </p>
                        <div className="panel-block">
                            <div className="field" style={{ width: '100%' }}>
                                <label className="checkbox">
                                    <input type="checkbox" checked={showAnimation} onChange={this.toggleAnimation} />
                                    {' '}Show animation
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
                        <div className="panel-block">
                            <p className="help" style={{ margin: 0 }}>
                                💡 Click on boxes in 3D view or in the list to see details<br />
                                ⌨️ Use Ctrl+←/→ to navigate between boxes
                            </p>
                        </div>
                    </nav>
                )}

                {packResult && packResult.boxes && packResult.boxes.length > 0 && (
                    <nav className="panel" style={{ flex: '0 0 auto', marginTop: '0.5rem' }}>
                        <p className="panel-heading">
                            <div className="level" style={{ margin: 0 }}>
                                <div className="level-left">
                                    <div className="level-item">
                                        <strong>Packed Boxes ({packResult.boxes.length})</strong>
                                    </div>
                                </div>
                                <div className="level-right">
                                    <div className="level-item">
                                        <div className="field has-addons">
                                            <p className="control">
                                                <button 
                                                    className="button is-small is-info" 
                                                    onClick={() => this.props.playground.selectPreviousBox()}
                                                    title="Previous box (Ctrl+←)"
                                                >
                                                    ←
                                                </button>
                                            </p>
                                            <p className="control">
                                                <button 
                                                    className="button is-small is-info" 
                                                    onClick={() => this.props.playground.selectNextBox()}
                                                    title="Next box (Ctrl+→)"
                                                >
                                                    →
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
                                        <div className="level" style={{ marginBottom: '0.25rem' }}>
                                            <div className="level-left">
                                                <div className="level-item">
                                                    <strong>Box #{index + 1} {box.id.slice(0, 8)}...</strong>
                                                    {isSelected && <span className="tag is-success" style={{ marginLeft: '0.5rem' }}>Selected</span>}
                                                </div>
                                            </div>
                                            <div className="level-right">
                                                <div className="level-item">
                                                    <span className="tag is-info">{stats.itemsCount} items</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="content is-small">
                                            <p style={{ marginBottom: '0.25rem' }}>
                                                Size: {Math.round(box.width)}×{Math.round(box.height)}×{Math.round(box.depth)}
                                            </p>
                                            <progress 
                                                className="progress is-small is-success" 
                                                value={stats.utilization} 
                                                max="100"
                                                style={{ marginBottom: '0.25rem' }}
                                            >
                                                {stats.utilization}%
                                            </progress>
                                            <p className="help" style={{ marginBottom: '0.25rem' }}>
                                                Volume: {stats.utilization}% used ({stats.usedVolume} / {stats.totalVolume})
                                            </p>
                                            <p className="help">
                                                Weight: {stats.weightUtilization}% used ({stats.usedWeight} / {Math.round(box.weight)})
                                            </p>
                                        </div>
                                    </div>
                                </a>
                            );
                        })}
                    </nav>
                )}

                {selectedBoxData && selectedBoxStats && (
                    <nav className="panel" style={{ flex: '0 0 auto', marginTop: '0.5rem' }}>
                        <p className="panel-heading">
                            <strong>Box Details</strong>
                        </p>
                        <div className="panel-block">
                            <div className="content" style={{ width: '100%' }}>
                                <p><strong>Dimensions:</strong> {Math.round(selectedBoxData.width)} × {Math.round(selectedBoxData.height)} × {Math.round(selectedBoxData.depth)}</p>
                                <p><strong>Max Weight:</strong> {Math.round(selectedBoxData.weight)}</p>
                                <p><strong>Items:</strong> {selectedBoxStats.itemsCount}</p>
                                <hr />
                                <p><strong>Volume Utilization:</strong> {selectedBoxStats.utilization}%</p>
                                <p className="help">Used: {selectedBoxStats.usedVolume} / Total: {selectedBoxStats.totalVolume}</p>
                                <p className="help">Free: {selectedBoxStats.freeVolume}</p>
                                <hr />
                                <p><strong>Weight Utilization:</strong> {selectedBoxStats.weightUtilization}%</p>
                                <p className="help">Used: {selectedBoxStats.usedWeight} / Max: {Math.round(selectedBoxData.weight)}</p>
                                <hr />
                                <p><strong>Items in box:</strong></p>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    {selectedBoxData.items.map((item, idx) => (
                                        <div key={item.id} className="box" style={{ padding: '0.5rem', marginBottom: '0.25rem' }}>
                                            <p className="help" style={{ marginBottom: '0.25rem' }}>
                                                <strong>#{idx + 1}</strong> {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)} 
                                                {' '}wg:{Math.round(item.weight)}
                                            </p>
                                            <p className="help" style={{ fontSize: '0.7rem', margin: 0 }}>
                                                Position: ({Math.round(item.position.x)}, {Math.round(item.position.y)}, {Math.round(item.position.z)})
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </nav>
                )}

                {packResult && packResult.items && packResult.items.length > 0 && (
                    <nav className="panel" style={{ flex: '0 0 auto', marginTop: '0.5rem' }}>
                        <p className="panel-heading has-background-danger-light">
                            <strong>Unfit Items ({packResult.items.length})</strong>
                        </p>
                        {packResult.items.map(item => (
                            <div key={item.id} className="panel-block">
                                {Math.round(item.width)}×{Math.round(item.height)}×{Math.round(item.depth)} wg:{Math.round(item.weight)}
                            </div>
                        ))}
                    </nav>
                )}
            </div>
        );
    }
}
