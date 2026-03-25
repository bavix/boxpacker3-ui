package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/bavix/boxpacker3/v2"
)

const (
	BoxTypeF       = "8ec81501-11a4-4b3f-9a52-7cd2f9c8370c"
	BoxTypeE       = "9c69baf8-1ca3-46a0-9fc2-6f15ad9fef9a"
	BoxTypeG       = "2c5279d3-48ad-451b-b673-f6d9be7fc6f6"
	BoxTypeC       = "7f1cc68f-d554-4094-8734-c68df5c13154"
	BoxTypeB       = "76cede41-86bb-4487-bfb0-9513f032d53e"
	BoxTypeA       = "8e10cebf-cee6-4136-b060-1587b993d083"
	BoxTypeStd     = "ba973206-aa64-493b-b37a-c53192cde8fd"
	BoxTypeNotStd1 = "cb1ed5b8-7405-48c5-bfd0-d86f75c99261"
	BoxTypeNotStd2 = "d91e2661-aebb-4a55-bfb5-4ff9c6e3c008"
	BoxTypeNotStd3 = "a0ecd730-375a-4313-bbe8-820710606b3d"
	BoxTypeNotStd4 = "6dff37f0-4dd1-4143-abdc-c19ab94f2e68"
	BoxTypeNotStd5 = "abac6d59-b51f-4d62-a338-42aca7afe1cc"
	BoxTypeNotStd6 = "981ffb30-a7b9-4d9e-820e-04de2145763e"
)

func Bp3Handle(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "post a packing request", http.StatusMethodNotAllowed)

		return
	}

	var payload request

	err := json.NewDecoder(req.Body).Decode(&payload)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	boxes, err := payload.boxes()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	items, err := payload.items()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	options, err := payload.options()
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)

		return
	}

	packer := boxpacker3.NewPacker(options...)

	start := time.Now()

	result, err := pack(req, packer, boxes, items)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	elapsed := time.Since(start).Milliseconds()

	body, err := json.Marshal(response{
		Boxes:         packedBoxes(result),
		UnfitItems:    leftBehind(result),
		ExecutionTime: elapsed,
		Warning:       explain(boxes, items, result),
		Report:        describeReport(result),
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)

		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(body)
}

func Bp3DefaultBoxesHandle(w http.ResponseWriter, _ *http.Request) {
	boxes := []box{
		{ID: BoxTypeF, Width: 220, Height: 185, Depth: 50, Weight: 20000},
		{ID: BoxTypeE, Width: 165, Height: 215, Depth: 100, Weight: 20000},
		{ID: BoxTypeG, Width: 265, Height: 165, Depth: 190, Weight: 20000},
		{ID: BoxTypeC, Width: 425, Height: 165, Depth: 190, Weight: 20000},
		{ID: BoxTypeB, Width: 425, Height: 265, Depth: 190, Weight: 20000},
		{ID: BoxTypeA, Width: 425, Height: 265, Depth: 380, Weight: 20000},
		{ID: BoxTypeStd, Width: 530, Height: 380, Depth: 265, Weight: 20000},
		{ID: BoxTypeNotStd1, Width: 1000, Height: 500, Depth: 500, Weight: 20000},
		{ID: BoxTypeNotStd2, Width: 1000, Height: 1000, Depth: 1000, Weight: 20000},
		{ID: BoxTypeNotStd3, Width: 2000, Height: 500, Depth: 500, Weight: 20000},
		{ID: BoxTypeNotStd4, Width: 2000, Height: 2000, Depth: 2000, Weight: 20000},
		{ID: BoxTypeNotStd5, Width: 2500, Height: 2500, Depth: 2500, Weight: 20000},
		{ID: BoxTypeNotStd6, Width: 3000, Height: 3000, Depth: 3000, Weight: 20000},
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(boxes)
}

func pack(
	req *http.Request,
	packer *boxpacker3.Packer,
	boxes []*boxpacker3.Box,
	items []*boxpacker3.Item,
) (*boxpacker3.Result, error) {
	return packer.Pack(req.Context(), boxes, items)
}

func explain(boxes []*boxpacker3.Box, items []*boxpacker3.Item, result *boxpacker3.Result) string {
	if result == nil || len(result.Unpacked) == 0 {
		return ""
	}

	if len(boxes) == 0 {
		return "No boxes to pack into. Add one on the Boxes tab."
	}

	counted := map[boxpacker3.Reason]int{}
	for _, left := range result.Unpacked {
		counted[left.Reason]++
	}

	offered := 0
	for _, item := range items {
		offered += item.Quantity()
	}

	left := len(result.Unpacked)

	switch {
	case counted[boxpacker3.ReasonNoOrientationFits] > 0 && counted[boxpacker3.ReasonTooBig] > 0:
		return fmt.Sprintf(
			"%d of %d items were left behind: %d are larger than every box you offered, %d only because their rotation is locked.",
			left, offered, counted[boxpacker3.ReasonTooBig], counted[boxpacker3.ReasonNoOrientationFits])
	case counted[boxpacker3.ReasonNoOrientationFits] > 0:
		return fmt.Sprintf(
			"%d items were left behind only because their rotation is locked. Free to turn, they fit.",
			counted[boxpacker3.ReasonNoOrientationFits])
	case counted[boxpacker3.ReasonTooBig] > 0:
		return fmt.Sprintf("%d of %d items are larger than every box you offered.",
			counted[boxpacker3.ReasonTooBig], offered)
	case counted[boxpacker3.ReasonTooHeavy] > 0:
		return fmt.Sprintf("%d of %d items weigh more than any box you offered may carry.",
			counted[boxpacker3.ReasonTooHeavy], offered)
	case counted[boxpacker3.ReasonRefusedByBox] > 0:
		return fmt.Sprintf("%d of %d items are refused by every box that could hold them.",
			counted[boxpacker3.ReasonRefusedByBox], offered)
	case counted[boxpacker3.ReasonGroupIncomplete] > 0:
		return fmt.Sprintf("%d items ship as a group and no box could take all of it.",
			counted[boxpacker3.ReasonGroupIncomplete])
	default:
		return fmt.Sprintf(
			"%d of %d items did not fit alongside the rest. A larger box, or more of the ones you have, would take them.",
			left, offered)
	}
}

func describePacked(source boxpacker3.PackedItem) item {
	return item{
		ID:              source.ID(),
		Width:           source.Dimension[0],
		Height:          source.Dimension[1],
		Depth:           source.Dimension[2],
		Weight:          source.Weight(),
		Rotation:        source.Item.Rotation().String(),
		Group:           source.Item.Group(),
		Quantity:        0,
		MaxLoadOnTop:    source.Item.MaxLoadOnTop(),
		NothingOnTop:    source.Item.NothingOnTop(),
		Class:           source.Item.Class(),
		SeparateFrom:    source.Item.SeparateFrom(),
		Position:        pos{X: source.Position[0], Y: source.Position[1], Z: source.Position[2]},
		Index:           source.Index,
		Reason:          "",
		Unpackable:      false,
		RotationBlocked: false,
	}
}

func describeUnpacked(source boxpacker3.UnpackedItem) item {
	return item{
		ID:              source.ID(),
		Width:           source.Item.Width(),
		Height:          source.Item.Height(),
		Depth:           source.Item.Depth(),
		Weight:          source.Weight(),
		Rotation:        source.Item.Rotation().String(),
		Group:           source.Item.Group(),
		Quantity:        0,
		MaxLoadOnTop:    source.Item.MaxLoadOnTop(),
		NothingOnTop:    source.Item.NothingOnTop(),
		Class:           source.Item.Class(),
		SeparateFrom:    source.Item.SeparateFrom(),
		Position:        pos{X: 0, Y: 0, Z: 0},
		Index:           source.Index,
		Reason:          source.Reason.String(),
		Unpackable:      source.Reason.Structural(),
		RotationBlocked: source.Reason == boxpacker3.ReasonNoOrientationFits,
	}
}

func packedBoxes(result *boxpacker3.Result) []boxPack {
	if result == nil {
		return []boxPack{}
	}

	packed := make([]boxPack, 0, len(result.Boxes))

	for _, source := range result.Boxes {

		id := source.ID()
		if source.Index > 0 {
			id = fmt.Sprintf("%s#%d", source.ID(), source.Index+1)
		}

		items := make([]item, 0, len(source.Items))
		for _, packedItem := range source.Items {
			items = append(items, describePacked(packedItem))
		}

		packed = append(packed, boxPack{
			ID:              id,
			Kind:            source.ID(),
			Index:           source.Index,
			Accepts:         source.Box.Accepts(),
			Width:           source.Box.Width(),
			Height:          source.Box.Height(),
			Depth:           source.Box.Depth(),
			Weight:          source.Box.MaxWeight(),
			OuterWidth:      source.Box.OuterWidth(),
			OuterHeight:     source.Box.OuterHeight(),
			OuterDepth:      source.Box.OuterDepth(),
			EmptyWeight:     source.Box.EmptyWeight(),
			ItemsWeight:     source.Stats.ItemsWeight,
			GrossWeight:     source.Stats.GrossWeight,
			VolumeUsed:      source.Stats.ItemsVolume,
			VolumeAvailable: source.Volume(),
			Items:           items,
		})
	}

	return packed
}

func leftBehind(result *boxpacker3.Result) []item {
	if result == nil {
		return []item{}
	}

	left := make([]item, 0, len(result.Unpacked))
	for _, source := range result.Unpacked {
		left = append(left, describeUnpacked(source))
	}

	return left
}

func describeReport(result *boxpacker3.Result) report {
	if result == nil {
		return report{Algorithm: "", Fill: 0, BoundBoxes: 0, GapBoxes: 0, Nodes: 0, Truncated: false, Candidates: nil}
	}

	candidates := make([]candidate, 0, len(result.Report.Candidates))

	for _, tried := range result.Report.Candidates {
		message := ""
		if tried.Err != nil {
			message = tried.Err.Error()
		}

		candidates = append(candidates, candidate{
			Algorithm: tried.Algorithm,
			Boxes:     tried.Boxes,
			Unpacked:  tried.Unpacked,
			Chosen:    tried.Chosen,
			Micros:    tried.Elapsed.Microseconds(),
			Error:     message,
		})
	}

	return report{
		Algorithm:  result.Report.Algorithm,
		Fill:       result.Report.Fill * 100,
		BoundBoxes: result.Report.Bound.Boxes,
		GapBoxes:   result.Report.GapBoxes,
		Nodes:      result.Report.Nodes,
		Truncated:  result.Report.Truncated,
		Candidates: candidates,
	}
}
