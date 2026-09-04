import {Playground} from "./playground.js"
import ItemComponent from "./item.jsx"
import React from 'react';

React.render(<ItemComponent playground={new Playground(null)} />, document.getElementById('app'))
