package app

import (
	"errors"
	"fmt"

	"github.com/bavix/boxpacker3/v2"
)

const maxExpandedItems = 5000

var (
	errUnknownRotation = errors.New("unknown rotation")
	errUnknownRule     = errors.New("unknown rule")
	errInvalidQuantity = errors.New("invalid quantity")
	errTooManyItems    = errors.New("too many items")
)

func orderByName(name string) (boxpacker3.ItemSorter, bool) {
	order, known := boxpacker3.ItemOrderByName(name)
	if !known {
		return boxpacker3.OrderDecreasing, false
	}

	return order, true
}

func selectionByName(name string) (boxpacker3.BoxSelection, bool) {
	for _, selection := range boxpacker3.BoxSelections() {
		if selection.String() == name {
			return selection, true
		}
	}

	return boxpacker3.SelectFirstFit, false
}

func rotationByName(name string) (boxpacker3.Rotation, error) {
	if name == "" {
		return boxpacker3.RotationBestFit, nil
	}

	for _, rotation := range boxpacker3.Rotations() {
		if rotation.String() == name {
			return rotation, nil
		}
	}

	return boxpacker3.RotationBestFit, fmt.Errorf("%w: %q", errUnknownRotation, name)
}

func (r request) boxes() ([]*boxpacker3.Box, error) {
	boxes := make([]*boxpacker3.Box, 0, len(r.Boxes))

	for _, spec := range r.Boxes {
		box, err := boxpacker3.NewBoxFromSpec(boxpacker3.BoxSpec{
			ID:          spec.ID,
			OuterWidth:  spec.Width,
			OuterHeight: spec.Height,
			OuterDepth:  spec.Depth,
			InnerWidth:  spec.InnerWidth,
			InnerHeight: spec.InnerHeight,
			InnerDepth:  spec.InnerDepth,
			EmptyWeight: spec.EmptyWeight,
			MaxWeight:   spec.Weight,
			Quantity:    spec.Quantity,
			Accepts:     spec.Accepts,
		})
		if err != nil {
			return nil, err
		}

		boxes = append(boxes, box)
	}

	return boxes, nil
}

func (r request) items() ([]*boxpacker3.Item, error) {
	items := make([]*boxpacker3.Item, 0, len(r.Items))
	total := 0

	for _, spec := range r.Items {
		if spec.Quantity < 0 {
			return nil, fmt.Errorf("%w: item %q asks for %d", errInvalidQuantity, spec.ID, spec.Quantity)
		}

		total += max(spec.Quantity, 1)
		if total > maxExpandedItems {
			return nil, fmt.Errorf("%w: %d requested, %d is the limit",
				errTooManyItems, total, maxExpandedItems)
		}

		rotation, err := rotationByName(spec.Rotation)
		if err != nil {
			return nil, err
		}

		item, err := boxpacker3.NewItemFromSpec(boxpacker3.ItemSpec{
			ID:           spec.ID,
			Width:        spec.Width,
			Height:       spec.Height,
			Depth:        spec.Depth,
			Weight:       spec.Weight,
			Rotation:     rotation,
			VerticalAxes: nil,
			Group:        spec.Group,
			Quantity:     max(spec.Quantity, 1),
			MaxLoadOnTop: spec.MaxLoadOnTop,
			NothingOnTop: spec.NothingOnTop,
			Class:        spec.Class,
			SeparateFrom: spec.SeparateFrom,
		})
		if err != nil {
			return nil, err
		}

		items = append(items, item)
	}

	return items, nil
}

func (r request) algorithm() (boxpacker3.Algorithm, error) {
	if r.Search != nil && !r.SearchFills {
		return boxpacker3.NewSearch(r.Search.Nodes, r.Search.Branching)
	}

	if !r.Parallel || len(r.Algorithms) == 0 {
		return r.goalAlgorithm(), nil
	}

	algorithms := make([]boxpacker3.Algorithm, 0, len(r.Algorithms))

	for _, name := range r.Algorithms {
		rule, ok := ruleByName(name)
		if !ok {
			return nil, fmt.Errorf("%w: %q", errUnknownRule, name)
		}

		algorithms = append(algorithms, boxpacker3.NewGreedy(rule.Order, rule.Selection))
	}

	goal := boxpacker3.FewestBoxes

	if r.Goal != nil {
		if named, ok := boxpacker3.GoalByName(*r.Goal); ok {
			goal = named
		}
	}

	return boxpacker3.NewPortfolio(goal, algorithms...), nil
}

func ruleByName(name string) (boxpacker3.RuleSettings, bool) {
	for _, rule := range boxpacker3.EveryRuleSettings() {
		if rule.Name() == name {
			return rule, true
		}
	}

	return boxpacker3.RuleSettings{Order: boxpacker3.OrderDecreasing, Selection: boxpacker3.SelectFirstFit}, false
}

func (r request) goalAlgorithm() boxpacker3.Algorithm {
	if r.Goal == nil {
		return nil
	}

	answer, ok := boxpacker3.BestForName(*r.Goal)
	if !ok {
		return nil
	}

	return answer
}

func (r request) options() ([]boxpacker3.Option, error) {
	options := []boxpacker3.Option{}

	algorithm, err := r.algorithm()
	if err != nil {
		return nil, err
	}

	switch {
	case algorithm != nil:
		options = append(options, boxpacker3.WithAlgorithm(algorithm))
	case r.Order != "" || r.Selection != "":
		order, _ := orderByName(r.Order)
		selection, _ := selectionByName(r.Selection)
		options = append(options, boxpacker3.WithAlgorithm(boxpacker3.NewGreedy(order, selection)))
	}

	if r.SingleContainer {
		options = append(options, boxpacker3.WithAlgorithm(boxpacker3.SingleContainer(algorithm)))
	}

	if r.Search != nil && r.SearchFills {
		search, err := boxpacker3.NewSearch(r.Search.Nodes, r.Search.Branching)
		if err != nil {
			return nil, err
		}

		options = append(options, boxpacker3.WithFiller(search))
	}

	return append(options, r.constraints()...), nil
}

func (r request) constraints() []boxpacker3.Option {
	options := []boxpacker3.Option{
		boxpacker3.WithRules(boxpacker3.Rules{
			MinSupportRatio:  r.SupportRatio,
			FreeSpaceCorners: r.FreeSpaceCorners,
		}),
	}

	if merit, known := boxpacker3.MeritByName(r.Merit); known {
		options = append(options, boxpacker3.WithMerit(merit))
	}

	if finishers := r.finishers(); len(finishers) > 0 {
		options = append(options, boxpacker3.WithFinishers(finishers...))
	}

	return options
}

func (r request) finishers() []boxpacker3.Finisher {
	passes := make([]boxpacker3.Finisher, 0, len(r.Finishers)+1)

	for _, name := range r.Finishers {
		if pass, known := finisherByName(name); known {
			passes = append(passes, pass)
		}
	}

	if r.BalanceBoxes != nil {
		passes = append(passes, boxpacker3.BalanceWeight{MaxBoxes: *r.BalanceBoxes})
	}

	return passes
}

func finisherByName(name string) (boxpacker3.Finisher, bool) {
	for _, pass := range []boxpacker3.Finisher{
		boxpacker3.Rehome, boxpacker3.Consolidate, boxpacker3.Rescue,
	} {
		if pass.Name() == name {
			return pass, true
		}
	}

	return nil, false
}
