import {Playground} from "./playground.js"
import ItemComponent from "./item.jsx"
import React from 'react';

const playground = new Playground(document.getElementById('bp3'))

React.render(<ItemComponent playground={playground} />, document.getElementById('bp3-input'))
