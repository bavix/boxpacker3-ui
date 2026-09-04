package app

type box struct {
	ID          string   `json:"id"`
	Width       float64  `json:"width"`
	Height      float64  `json:"height"`
	Depth       float64  `json:"depth"`
	Weight      float64  `json:"weight"`
	InnerWidth  float64  `json:"innerWidth,omitempty"`
	InnerHeight float64  `json:"innerHeight,omitempty"`
	InnerDepth  float64  `json:"innerDepth,omitempty"`
	EmptyWeight float64  `json:"emptyWeight,omitempty"`
	Quantity    int      `json:"quantity,omitempty"`
	Accepts     []string `json:"accepts,omitempty"`
}

type pos struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type item struct {
	ID              string   `json:"id"`
	Width           float64  `json:"width"`
	Height          float64  `json:"height"`
	Depth           float64  `json:"depth"`
	Weight          float64  `json:"weight"`
	Rotation        string   `json:"rotation,omitempty"`
	Group           string   `json:"group,omitempty"`
	Quantity        int      `json:"quantity,omitempty"`
	MaxLoadOnTop    float64  `json:"maxLoadOnTop,omitempty"`
	NothingOnTop    bool     `json:"nothingOnTop,omitempty"`
	Class           string   `json:"class,omitempty"`
	SeparateFrom    []string `json:"separateFrom,omitempty"`
	Position        pos      `json:"position"`
	Index           int      `json:"index,omitempty"`
	Reason          string   `json:"reason,omitempty"`
	Unpackable      bool     `json:"unpackable,omitempty"`
	RotationBlocked bool     `json:"rotationBlocked,omitempty"`
}

type boxPack struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	Index           int      `json:"index"`
	Accepts         []string `json:"accepts,omitempty"`
	Width           float64  `json:"width"`
	Height          float64  `json:"height"`
	Depth           float64  `json:"depth"`
	Weight          float64  `json:"weight"`
	OuterWidth      float64  `json:"outerWidth"`
	OuterHeight     float64  `json:"outerHeight"`
	OuterDepth      float64  `json:"outerDepth"`
	EmptyWeight     float64  `json:"emptyWeight"`
	ItemsWeight     float64  `json:"itemsWeight"`
	GrossWeight     float64  `json:"grossWeight"`
	VolumeUsed      float64  `json:"volumeUsed"`
	VolumeAvailable float64  `json:"volumeAvailable"`
	Items           []item   `json:"items"`
}

type searchSettings struct {
	Nodes     int `json:"nodes"`
	Branching int `json:"branching"`
}

type request struct {
	Boxes            []box           `json:"boxes"`
	Items            []item          `json:"items"`
	Order            string          `json:"order,omitempty"`
	Selection        string          `json:"selection,omitempty"`
	Parallel         bool            `json:"parallel,omitempty"`
	Algorithms       []string        `json:"algorithms,omitempty"`
	Goal             *string         `json:"goal,omitempty"`
	SupportRatio     float64         `json:"supportRatio,omitempty"`
	BalanceBoxes     *int            `json:"balanceBoxes,omitempty"`
	FreeSpaceCorners bool            `json:"freeSpaceCorners,omitempty"`
	Search           *searchSettings `json:"search,omitempty"`
	SearchFills      bool            `json:"searchFills,omitempty"`
	SingleContainer  bool            `json:"singleContainer,omitempty"`
	Merit            string          `json:"merit,omitempty"`
	Finishers        []string        `json:"finishers,omitempty"`
}

type candidate struct {
	Algorithm string `json:"algorithm"`
	Boxes     int    `json:"boxes"`
	Unpacked  int    `json:"unpacked"`
	Chosen    bool   `json:"chosen"`
	Micros    int64  `json:"micros"`
	Error     string `json:"error,omitempty"`
}

type report struct {
	Algorithm  string      `json:"algorithm"`
	Fill       float64     `json:"fill"`
	BoundBoxes int         `json:"boundBoxes"`
	GapBoxes   int         `json:"gapBoxes"`
	Nodes      int         `json:"nodes,omitempty"`
	Truncated  bool        `json:"truncated,omitempty"`
	Candidates []candidate `json:"candidates,omitempty"`
}

type response struct {
	Boxes         []boxPack `json:"boxes"`
	UnfitItems    []item    `json:"items"`
	ExecutionTime int64     `json:"executionTime"`
	Warning       string    `json:"warning,omitempty"`
	Report        report    `json:"report"`
}
