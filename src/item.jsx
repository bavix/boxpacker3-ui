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
}

export default class ItemComponent extends React.Component {
    state = {
        hasError: false,
        text: '',
        type: itemType,
        elements: [],
    };

    constructor() {
        super(...arguments)
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

        await this.playgroundRender(elements)
    }

    setText = e => {
        this.setState({ text: e.target.value });
    }
    setType = v => {
        this.setState({ type: v })
    }
    switchEnabled = async id => {
        const { elements } = this.state;
        const element = elements.find(
            e => e.id === id,
        )

        element.enabled = !element.enabled

        this.setState({ elements })
        await this.playgroundRender(elements)
    }

    addElement = async () => {
        let { elements, type, text } = this.state;
        const matchResult = text.match(datumValidate)

        if (matchResult === null) {
            this.setState({ hasError: true })

            return
        }

        const id = generateUUID()
        const datum = new Datum(id, type, matchResult[1], matchResult[2], matchResult[3], matchResult[4])

        elements = elements.concat(datum)

        this.setState({ elements, text: '', hasError: false });
        await this.playgroundRender(elements)
    }

    playgroundRender = async elements => {
        const items = elements.filter(e => e.enabled)

        this.props.playground.render(
            await api('/bp3', {
                boxes: items.filter(i => i.type === boxType),
                items: items.filter(i => i.type === itemType),
            })
        )
    }

    render({ }, { elements, type, text, hasError }) {
        return (
            <nav className="panel">
                <p className="panel-heading">
                    Settings
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
                        <a className={type === boxType ? "is-active" : ""} onClick={() => this.setType(boxType)}>Boxes</a>
                        <a className={type === itemType ? "is-active" : ""} onClick={() => this.setType(itemType)}>Items</a>
                    </p>
                </form>
                { elements.filter(datum => datum.type === type).map(datum => (
                    <label key={datum.id} className="panel-block">
                        <input type="checkbox" checked={datum.enabled} onChange={() => this.switchEnabled(datum.id)} />
                        {datum.toString()}
                    </label>
                ))}
            </nav>
        );
    }
}
