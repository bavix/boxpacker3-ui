package app

import (
	"encoding/json"
	"net/http"

	"github.com/bavix/boxpacker3"
)

const (
	// BoxTypeF -- 220, 185, 50, 20000.
	BoxTypeF = "8ec81501-11a4-4b3f-9a52-7cd2f9c8370c"

	// BoxTypeE -- 165, 215, 100, 20000.
	BoxTypeE = "9c69baf8-1ca3-46a0-9fc2-6f15ad9fef9a"

	// BoxTypeG -- 265, 165, 190, 20000.
	BoxTypeG = "2c5279d3-48ad-451b-b673-f6d9be7fc6f6"

	// BoxTypeC -- 425, 165, 190, 20000.
	BoxTypeC = "7f1cc68f-d554-4094-8734-c68df5c13154"

	// BoxTypeB -- 425, 265, 190, 20000.
	BoxTypeB = "76cede41-86bb-4487-bfb0-9513f032d53e"

	// BoxTypeA -- 425, 265, 380, 20000.
	BoxTypeA = "8e10cebf-cee6-4136-b060-1587b993d083"

	// BoxTypeStd -- 530, 380, 265, 20000.
	BoxTypeStd = "ba973206-aa64-493b-b37a-c53192cde8fd"

	// BoxTypeNotStd1 -- 1000, 500, 500, 20000.
	BoxTypeNotStd1 = "cb1ed5b8-7405-48c5-bfd0-d86f75c99261"

	// BoxTypeNotStd2 -- 1000, 1000, 1000, 20000.
	BoxTypeNotStd2 = "d91e2661-aebb-4a55-bfb5-4ff9c6e3c008"

	// BoxTypeNotStd3 -- 2000, 500, 500, 20000.
	BoxTypeNotStd3 = "a0ecd730-375a-4313-bbe8-820710606b3d"

	// BoxTypeNotStd4 -- 2000, 2000, 2000, 20000.
	BoxTypeNotStd4 = "6dff37f0-4dd1-4143-abdc-c19ab94f2e68"

	// BoxTypeNotStd5 -- 2500, 2500, 2500, 20000.
	BoxTypeNotStd5 = "abac6d59-b51f-4d62-a338-42aca7afe1cc"

	// BoxTypeNotStd6 -- 3000, 3000, 3000, 20000.
	BoxTypeNotStd6 = "981ffb30-a7b9-4d9e-820e-04de2145763e"
)

type box struct {
	ID     string  `json:"id"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Depth  float64 `json:"depth"`
	Weight float64 `json:"weight"`
}

type pos struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

type item struct {
	ID       string  `json:"id"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Depth    float64 `json:"depth"`
	Weight   float64 `json:"weight"`
	Position pos     `json:"position"`
}

type boxPack struct {
	ID     string  `json:"id"`
	Width  float64 `json:"width"`
	Height float64 `json:"height"`
	Depth  float64 `json:"depth"`
	Weight float64 `json:"weight"`
	Items  []item  `json:"items"`
}

type request struct {
	Boxes []box  `json:"boxes"`
	Items []item `json:"items"`
}

type response struct {
	Boxes      []boxPack `json:"boxes"`
	UnfitItems []item    `json:"items"`
}

func Bp3Handle(w http.ResponseWriter, req *http.Request) {
	decoder := json.NewDecoder(req.Body)

	var t request
	err := decoder.Decode(&t)

	if err != nil {
		return
	}

	boxes := make([]*boxpacker3.Box, 0, len(t.Boxes))
	for _, box := range t.Boxes {
		boxes = append(boxes, boxpacker3.NewBox(box.ID, box.Width, box.Height, box.Depth, box.Weight))
	}

	items := make([]*boxpacker3.Item, 0, len(t.Items))
	for _, item := range t.Items {
		items = append(items, boxpacker3.NewItem(item.ID, item.Width, item.Height, item.Depth, item.Weight))
	}

	packer := boxpacker3.NewPacker()

	packResult := packer.Pack(boxes, items)

	boxResp := make([]boxPack, 0, len(packResult.Boxes))
	for _, b := range packResult.Boxes {
		items := make([]item, 0, len(b.GetItems()))
		for _, i := range b.GetItems() {
			p := i.GetPosition()
			d := i.GetDimension()
			items = append(items, item{
				ID:       i.GetID(),
				Width:    d[0],
				Height:   d[1],
				Depth:    d[2],
				Weight:   i.GetWeight(),
				Position: pos{X: p[0], Y: p[1], Z: p[2]},
			})
		}

		boxResp = append(boxResp, boxPack{
			ID:     b.GetID(),
			Width:  b.GetWidth(),
			Height: b.GetHeight(),
			Depth:  b.GetDepth(),
			Weight: b.GetMaxWeight(),
			Items:  items,
		})
	}

	unfitItems := make([]item, 0, len(packResult.UnfitItems))
	for _, i := range packResult.UnfitItems {
		p := i.GetPosition()
		d := i.GetDimension()
		unfitItems = append(unfitItems, item{
			ID:       i.GetID(),
			Width:    d[0],
			Height:   d[1],
			Depth:    d[2],
			Weight:   i.GetWeight(),
			Position: pos{X: p[0], Y: p[1], Z: p[2]},
		})
	}

	_ = json.NewEncoder(w).Encode(response{
		Boxes:      boxResp,
		UnfitItems: unfitItems,
	})
}

func Bp3DefaultBoxesHandle(w http.ResponseWriter, req *http.Request) {
	boxes := []box{
		{BoxTypeF, 220, 185, 50, 20000},           // 0
		{BoxTypeE, 165, 215, 100, 20000},          // 1
		{BoxTypeG, 265, 165, 190, 20000},          // 2
		{BoxTypeC, 425, 165, 190, 20000},          // 3
		{BoxTypeB, 425, 265, 190, 20000},          // 4
		{BoxTypeA, 425, 265, 380, 20000},          // 5
		{BoxTypeStd, 530, 380, 265, 20000},        // 6
		{BoxTypeNotStd1, 1000, 500, 500, 20000},   // 7
		{BoxTypeNotStd2, 1000, 1000, 1000, 20000}, // 8
		{BoxTypeNotStd3, 2000, 500, 500, 20000},   // 9
		{BoxTypeNotStd4, 2000, 2000, 2000, 20000}, // 10
		{BoxTypeNotStd5, 2500, 2500, 2500, 20000}, // 11
		{BoxTypeNotStd6, 3000, 3000, 3000, 20000}, // 12
	}

	_ = json.NewEncoder(w).Encode(boxes)
}
