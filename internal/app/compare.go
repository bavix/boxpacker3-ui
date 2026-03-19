package app

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/bavix/boxpacker3/v2"
)

type containerBrief struct {
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Depth  float64 `json:"depth"`
	Fill   float64 `json:"fill"`
	Items  int     `json:"items"`
}

type comparison struct {
	Order      string           `json:"order"`
	Selection  string           `json:"selection"`
	Boxes      int              `json:"boxes"`
	Packed     int              `json:"packed"`
	Unfit      int              `json:"unfit"`
	Fill       float64          `json:"fill"`
	Capacity   float64          `json:"capacity"`
	Containers []containerBrief `json:"containers"`
	Micros     int64            `json:"micros"`
	Goal       string           `json:"goal,omitempty"`
	Failed     bool             `json:"failed,omitempty"`
}

const timedRuns = 3

func Bp3CompareHandle(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "post a packing request to compare", http.StatusMethodNotAllowed)

		return
	}

	var payload request

	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	if _, err := payload.boxes(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	if _, err := payload.items(); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	orders := boxpacker3.ItemOrders()
	selections := boxpacker3.BoxSelections()

	rows := make([]comparison, 0, len(orders)*len(selections)+1)

	for _, order := range orders {
		for _, selection := range selections {
			rows = append(rows, compareOne(req.Context(), payload, order, selection, extra{}))
		}
	}

	for _, one := range extras() {
		rows = append(rows, compareOne(req.Context(), payload,
			boxpacker3.OrderDecreasing, boxpacker3.SelectFirstFit, one))
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(rows); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

type extra struct {
	label     string
	goal      string
	algorithm func() (boxpacker3.Algorithm, error)
}

var errUnknownGoal = errors.New("no algorithm for goal")

func goalLabel(name string) string {
	written, ok := goalText[name]
	if !ok {
		return name
	}

	return strings.ToLower(written[0])
}

func extras() []extra {
	search := func() (boxpacker3.Algorithm, error) {
		return boxpacker3.NewSearch(128, 5)
	}

	byName := func(name string) func() (boxpacker3.Algorithm, error) {
		return func() (boxpacker3.Algorithm, error) {
			answer, ok := boxpacker3.BestForName(name)
			if !ok {
				return nil, fmt.Errorf("%w: %s", errUnknownGoal, name)
			}

			return answer, nil
		}
	}

	trials := []extra{{label: "search", goal: "", algorithm: search}}

	for _, name := range boxpacker3.GoalNames() {
		trials = append(trials, extra{label: goalLabel(name), goal: name, algorithm: byName(name)})
	}

	return trials
}

func compareOne(
	ctx context.Context,
	payload request,
	order boxpacker3.ItemSorter,
	selection boxpacker3.BoxSelection,
	one extra,
) comparison {
	label := selection.String()
	if one.label != "" {
		label = one.label
	}

	shown := order.Name()
	if one.goal != "" {
		shown = "every order"
	}

	row := comparison{
		Order: shown, Selection: label,
		Boxes: 0, Packed: 0, Unfit: 0, Fill: 0,
		Capacity: 0, Containers: []containerBrief{}, Micros: 0, Goal: one.goal, Failed: true,
	}

	boxes, err := payload.boxes()
	if err != nil {
		return row
	}

	items, err := payload.items()
	if err != nil {
		return row
	}

	options := append([]boxpacker3.Option{
		boxpacker3.WithAlgorithm(boxpacker3.NewGreedy(order, selection)),
	}, payload.constraints()...)

	if one.algorithm != nil {
		algorithm, err := one.algorithm()
		if err != nil {
			return row
		}

		options = append(options, boxpacker3.WithAlgorithm(algorithm))
	}

	packer := boxpacker3.NewPacker(options...)

	pack := func() (*boxpacker3.Result, error) {
		return packer.Pack(ctx, boxes, items)
	}

	var result *boxpacker3.Result

	fastest := int64(math.MaxInt64)

	for range timedRuns {
		started := time.Now()

		result, err = pack()
		if err != nil {
			return row
		}

		if elapsed := time.Since(started).Microseconds(); elapsed < fastest {
			fastest = elapsed
		}
	}

	row.Micros = fastest
	row.Failed = false
	row.Unfit = len(result.Unpacked)

	var used, capacity float64

	row.Containers = make([]containerBrief, 0, len(result.Boxes))

	for _, box := range result.Boxes {
		inside := box.Stats.ItemsVolume

		row.Boxes++
		row.Packed += len(box.Items)
		capacity += box.Volume()
		used += inside

		brief := containerBrief{
			Width:  math.Round(box.Box.Width()),
			Height: math.Round(box.Box.Height()),
			Depth:  math.Round(box.Box.Depth()),
			Fill:   box.Stats.Fill * 100,
			Items:  len(box.Items),
		}

		row.Containers = append(row.Containers, brief)
	}

	row.Capacity = capacity

	if capacity > 0 {
		row.Fill = used / capacity * 100
	}

	slices.SortFunc(row.Containers, func(a, b containerBrief) int {
		return cmp.Compare(b.Width*b.Height*b.Depth, a.Width*a.Height*a.Depth)
	})

	return row
}
