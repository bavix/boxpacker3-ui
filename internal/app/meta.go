package app

import (
	"encoding/json"
	"net/http"

	"github.com/bavix/boxpacker3/v2"
)

type option struct {
	Value       string `json:"value"`
	Label       string `json:"label"`
	Gist        string `json:"gist"`
	Description string `json:"description"`
	Bound       string `json:"bound,omitempty"`
	Measured    string `json:"measured,omitempty"`
}

type namedRule struct {
	Name      string `json:"name"`
	Order     string `json:"order"`
	Selection string `json:"selection"`
}

type meta struct {
	Orders     []option    `json:"orders"`
	Selections []option    `json:"selections"`
	Rotations  []option    `json:"rotations"`
	Goals      []option    `json:"goals"`
	Rules      []namedRule `json:"rules"`
	Reasons    []option    `json:"reasons"`
	Merits     []option    `json:"merits"`
	Finishers  []option    `json:"finishers"`
}

var meritText = map[string][2]string{
	"contact-first":    {"Contact first", "How much of the piece touches a wall or a neighbour, ties settled low and near. The default."},
	"corner-first":     {"Corner first", "Deepest, then lowest, then leftmost; contact only breaks a tie. The classical rule."},
	"residual-fit":     {"Residual fit", "The placement that leaves the least room unused along the three axes."},
	"weighted-contact": {"Weighted contact", "Contact again, with the floor and the two walls a load is built against counted for more."},
}

var finisherText = map[string][2]string{
	"Rehome":        {"Rehome", "Move each box's contents into the smallest kind that holds all of it."},
	"Consolidate":   {"Consolidate", "Empty the least-full box into the others for as long as one can be freed."},
	"Rescue":        {"Rescue", "Offer the goods nothing would take to whatever room the other passes opened."},
	"BalanceWeight": {"Balance weight", "Even the weight across the boxes used. On by default, up to twelve boxes."},
}

var orderText = map[string][2]string{
	"decreasing":     {"Largest first", "By volume, largest first. What the classical decreasing variants assume."},
	"increasing":     {"Smallest first", "By volume, smallest first. Small goods take the room before the large ones ask."},
	"as-given":       {"As given", "Your order, untouched."},
	"heaviest-first": {"Heaviest first", "By weight, heaviest first. The load settles onto what can carry it."},
	"longest-first":  {"Longest first", "By longest edge. The awkward goods find their place before the room is gone."},
}

var selectionText = map[string]option{
	"first-fit": {
		Label:       "First fit",
		Gist:        "the first box that fits",
		Description: "Cheap, and hard to beat on box count for what it costs.",
		Bound:       "≤ 1.7× the fewest boxes",
		Measured:    "1.10 boxes · 37.7 L",
	},
	"best-fit": {
		Label:       "Best fit",
		Gist:        "the open box with least room left",
		Description: "Saves space, not boxes. Opens a tight carton per article on a mixed catalogue.",
		Bound:       "≤ 1.7× the fewest boxes",
		Measured:    "3.72 boxes · 39.0 L",
	},
	"worst-fit": {
		Label:       "Worst fit",
		Gist:        "the open box with most room left",
		Description: "Levels the load across boxes of one size. On a mixed catalogue it means the largest box, every time, for 61% more container and nothing in return.",
		Bound:       "≤ 2× the fewest boxes, for boxes of one size",
		Measured:    "one size: 4.66 boxes, spread 219 · catalogue: 53.4 L",
	},
	"almost-worst-fit": {
		Label:       "Almost worst fit",
		Gist:        "the open box with second most room",
		Description: "Standing one place back from worst fit is what earns the better bound. The same habit on a mixed catalogue, one place back.",
		Bound:       "≤ 1.7× the fewest boxes, for boxes of one size",
		Measured:    "one size: 4.50 boxes, spread 305 · catalogue: 42.9 L",
	},
	"next-fit": {
		Label:       "Next fit",
		Gist:        "the box in hand, never going back",
		Description: "Will abandon goods a closed box would have taken. For boxes sealed as they are filled. For an even load the balanced goal beats it: half the spread for the same boxes.",
		Bound:       "≤ 2× the fewest boxes, for boxes of one size",
		Measured:    "one size: 5.71 boxes, spread 111 · catalogue: 34.3 L",
	},
	"fullest-box": {
		Label:       "Fullest box",
		Gist:        "the box that swallows most of the rest",
		Description: "Judges a box by the whole order, not by one item. The default, and the least container paid for on a mixed catalogue.",
		Bound:       "ours, no published bound",
		Measured:    "one size: 4.19 boxes · catalogue: 33.1 L",
	},
}

var rotationText = map[string][2]string{
	"best-fit":  {"Any orientation", "Any face may point upwards."},
	"keep-flat": {"Keep flat", "The declared depth stays vertical; a quarter turn in the plane is still allowed."},
	"never":     {"Never rotate", "Packed exactly as declared."},
}

var goalText = map[string][2]string{
	"FewestBoxes":    {"Fewest boxes", "Every rule is tried, the fewest-boxes answer kept, then boxes are emptied into one another for as long as one can be freed."},
	"MostItems":      {"Most items packed", "Every rule is tried and the answer that leaves least behind is kept, whatever it costs in boxes."},
	"LeastVolume":    {"Tightest packing", "Every rule is tried and the answer whose boxes come to least volume is kept."},
	"HighestFill":    {"Fullest boxes", "Every rule is tried and the answer with the highest average fill is kept."},
	"BalancedWeight": {"Balanced weight", "Every rule is tried and the answer with the most even weight across boxes is kept."},
}

var reasonText = map[string][2]string{
	"no room":                       {"No room", "A box could have held it, but the boxes filled up first."},
	"too big":                       {"Too big", "No box you offered is large enough in any orientation it may take."},
	"too heavy":                     {"Too heavy", "No box you offered may carry it once its tare is counted."},
	"no permitted orientation fits": {"Rotation locked", "It would fit a box turned another way, but its rotation is locked."},
	"refused by every box":          {"Refused", "Every box that could hold it is dedicated to other classes of goods."},
	"group incomplete":              {"Group split", "It ships with a group and no box could take the whole group."},
	"cancelled":                     {"Cancelled", "The packing was cut short."},
}

func describe(value string, text map[string][2]string) option {
	prose, ok := text[value]
	if !ok {
		return option{Value: value, Label: value, Gist: "", Description: "", Bound: "", Measured: ""}
	}

	return option{
		Value: value, Label: prose[0], Gist: "", Description: prose[1], Bound: "", Measured: "",
	}
}

func describeRule(value string) option {
	written, ok := selectionText[value]
	if !ok {
		return option{Value: value, Label: value, Gist: "", Description: "", Bound: "", Measured: ""}
	}

	written.Value = value

	return written
}

func Bp3MetaHandle(w http.ResponseWriter, _ *http.Request) {
	catalogue := meta{
		Orders:     make([]option, 0, len(boxpacker3.ItemOrders())),
		Selections: make([]option, 0, len(boxpacker3.BoxSelections())),
		Rotations:  make([]option, 0, len(boxpacker3.Rotations())),
		Goals:      make([]option, 0, len(boxpacker3.GoalNames())),
		Rules:      make([]namedRule, 0, len(boxpacker3.EveryRuleSettings())),
		Reasons:    make([]option, 0, len(boxpacker3.Reasons())),
		Merits:     make([]option, 0, len(boxpacker3.Merits())),
		Finishers:  make([]option, 0, len(finisherText)),
	}

	for _, order := range boxpacker3.ItemOrders() {
		catalogue.Orders = append(catalogue.Orders, describe(order.Name(), orderText))
	}

	for _, selection := range boxpacker3.BoxSelections() {
		catalogue.Selections = append(catalogue.Selections, describeRule(selection.String()))
	}

	for _, rotation := range boxpacker3.Rotations() {
		catalogue.Rotations = append(catalogue.Rotations, describe(rotation.String(), rotationText))
	}

	for _, name := range boxpacker3.GoalNames() {
		catalogue.Goals = append(catalogue.Goals, describe(name, goalText))
	}

	for _, rule := range boxpacker3.EveryRuleSettings() {
		catalogue.Rules = append(catalogue.Rules, namedRule{
			Name:      rule.Name(),
			Order:     rule.Order.Name(),
			Selection: rule.Selection.String(),
		})
	}

	for _, reason := range boxpacker3.Reasons() {
		catalogue.Reasons = append(catalogue.Reasons, describe(reason.String(), reasonText))
	}

	for _, merit := range boxpacker3.Merits() {
		catalogue.Merits = append(catalogue.Merits, describe(merit.Name(), meritText))
	}

	for _, name := range []string{"Rehome", "Consolidate", "Rescue", "BalanceWeight"} {
		catalogue.Finishers = append(catalogue.Finishers, describe(name, finisherText))
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(catalogue)
}
