package app_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bavix/boxpacker3-ui/internal/app"
)

func post(t *testing.T, handler http.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()

	recorder := httptest.NewRecorder()
	handler(recorder, httptest.NewRequest(http.MethodPost, "/bp3", strings.NewReader(body)))

	return recorder
}

func TestBp3Handle_RejectsAnythingButPost(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	app.Bp3Handle(recorder, httptest.NewRequest(http.MethodGet, "/bp3", nil))

	if recorder.Code != http.StatusMethodNotAllowed {
		t.Errorf("want 405, got %d", recorder.Code)
	}
}

func TestBp3Handle_BadRequests(t *testing.T) {
	t.Parallel()

	cases := map[string]struct {
		body string
		says string
	}{
		"empty body":        {"", "EOF"},
		"not an object":     {"[]", "cannot unmarshal"},
		"nonsense":          {"not json", "invalid character"},
		"zero dimension":    {`{"boxes":[{"id":"b","width":0,"height":1,"depth":1,"weight":1}]}`, "invalid dimension"},
		"negative quantity": {`{"boxes":[{"id":"b","width":1,"height":1,"depth":1,"weight":1,"quantity":-5}]}`, "invalid quantity"},
		"unknown rotation": {
			`{"boxes":[{"id":"b","width":10,"height":10,"depth":10,"weight":10}],` +
				`"items":[{"id":"i","width":1,"height":1,"depth":1,"weight":1,"rotation":"nope"}]}`,
			"unknown rotation",
		},
		"too many items": {
			`{"boxes":[{"id":"b","width":10,"height":10,"depth":10,"weight":10}],` +
				`"items":[{"id":"i","width":1,"height":1,"depth":1,"weight":1,"quantity":100000}]}`,
			"too many items",
		},
	}

	for name, test := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			recorder := post(t, app.Bp3Handle, test.body)

			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("want 400, got %d with body %q", recorder.Code, recorder.Body.String())
			}

			if !strings.Contains(recorder.Body.String(), test.says) {
				t.Errorf("want a reason mentioning %q, got %q", test.says, recorder.Body.String())
			}
		})
	}
}

func TestBp3Handle_EmptyOrderIsNotAnError(t *testing.T) {
	t.Parallel()

	for _, body := range []string{"null", "{}", `{"boxes":null,"items":null}`, `{"boxes":[],"items":[]}`} {
		recorder := post(t, app.Bp3Handle, body)

		if recorder.Code != http.StatusOK {
			t.Errorf("%s gave %d: %s", body, recorder.Code, recorder.Body.String())
		}
	}
}

type packResponse struct {
	Boxes []struct {
		ID          string       `json:"id"`
		Kind        string       `json:"kind"`
		Accepts     []string     `json:"accepts"`
		EmptyWeight float64      `json:"emptyWeight"`
		ItemsWeight float64      `json:"itemsWeight"`
		GrossWeight float64      `json:"grossWeight"`
		Items       []packedItem `json:"items"`
	} `json:"boxes"`
	UnfitItems []struct {
		ID     string `json:"id"`
		Reason string `json:"reason"`
	} `json:"items"`
	Report struct {
		Algorithm  string  `json:"algorithm"`
		Fill       float64 `json:"fill"`
		BoundBoxes int     `json:"boundBoxes"`
		GapBoxes   int     `json:"gapBoxes"`
		Nodes      int     `json:"nodes"`
	} `json:"report"`
}

type packedItem struct {
	ID           string  `json:"id"`
	Width        float64 `json:"width"`
	Height       float64 `json:"height"`
	Depth        float64 `json:"depth"`
	NothingOnTop bool    `json:"nothingOnTop"`
	Position     struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
		Z float64 `json:"z"`
	} `json:"position"`
}

func TestBp3Handle_RepeatedBoxesGetDistinctIds(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"crate","width":200,"height":200,"depth":200,"weight":20000,"quantity":3}],`+
			`"items":[{"id":"cube","width":190,"height":190,"depth":190,"weight":100,"quantity":3}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	if len(got.Boxes) != 3 {
		t.Fatalf("want three crates, got %d", len(got.Boxes))
	}

	seen := map[string]bool{}

	for _, box := range got.Boxes {
		if seen[box.ID] {
			t.Errorf("id %q came back twice", box.ID)
		}

		seen[box.ID] = true

		if box.Kind != "crate" {
			t.Errorf("want kind %q, got %q", "crate", box.Kind)
		}
	}
}

func TestBp3Handle_ReportsGrossWeight(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"tared","width":200,"height":200,"depth":200,"weight":10000,"emptyWeight":4000}],`+
			`"items":[{"id":"brick","width":90,"height":90,"depth":90,"weight":2000,"quantity":3}]}`)

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	if len(got.Boxes) != 1 {
		t.Fatalf("want one box, got %d", len(got.Boxes))
	}

	box := got.Boxes[0]

	if box.ItemsWeight != 6000 || box.EmptyWeight != 4000 || box.GrossWeight != 10000 {
		t.Errorf("want 6000 net, 4000 tare, 10000 gross; got %v, %v, %v",
			box.ItemsWeight, box.EmptyWeight, box.GrossWeight)
	}
}

func TestBp3Handle_NothingIsLost(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"crate","width":200,"height":200,"depth":100,"weight":1000000}],`+
			`"items":[{"id":"cube","width":90,"height":90,"depth":90,"weight":100,"quantity":10}]}`)

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	packed := 0
	for _, box := range got.Boxes {
		packed += len(box.Items)
	}

	if packed+len(got.UnfitItems) != 10 {
		t.Errorf("sent 10, got %d packed and %d left", packed, len(got.UnfitItems))
	}
}

func TestBp3Handle_KeepsAClearItemClear(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"crate","width":300,"height":300,"depth":300,"weight":100000}],`+
			`"items":[{"id":"glass","width":100,"height":100,"depth":100,"weight":500,"nothingOnTop":true},`+
			`{"id":"brick","width":100,"height":100,"depth":100,"weight":4000,"quantity":3}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	marked := false

	for _, box := range got.Boxes {
		var glass *packedItem

		for _, packed := range box.Items {
			if packed.ID == "glass" {
				marked = marked || packed.NothingOnTop
				glass = &packed
			}
		}

		if glass == nil {
			continue
		}

		for _, packed := range box.Items {
			if packed.ID == "glass" || packed.Position.Z < glass.Position.Z+glass.Depth {
				continue
			}

			if overlapping(packed.Position.X, packed.Width, glass.Position.X, glass.Width) &&
				overlapping(packed.Position.Y, packed.Height, glass.Position.Y, glass.Height) {
				t.Errorf("%s sits on the item that must stay clear", packed.ID)
			}
		}
	}

	if !marked {
		t.Error("the response did not carry the clear-item flag")
	}
}

func overlapping(aStart, aSize, bStart, bSize float64) bool {
	return min(aStart+aSize, bStart+bSize)-max(aStart, bStart) > 0
}

func TestBp3Handle_KeepsClassesApart(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"hold","width":400,"height":400,"depth":400,"weight":100000,"quantity":2}],`+
			`"items":[{"id":"flour","width":100,"height":100,"depth":100,"weight":500,`+
			`"class":"food","separateFrom":["chemicals"]},`+
			`{"id":"bleach","width":100,"height":100,"depth":100,"weight":500,"class":"chemicals"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	if len(got.Boxes) != 2 {
		t.Fatalf("goods that must stay apart came back in %d boxes", len(got.Boxes))
	}

	for _, box := range got.Boxes {
		if len(box.Items) != 1 {
			t.Errorf("%s holds %d items", box.ID, len(box.Items))
		}
	}
}

func TestBp3Handle_DedicatedBoxTakesOnlyWhatItNames(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3Handle,
		`{"boxes":[{"id":"reefer","width":400,"height":400,"depth":400,"weight":100000,`+
			`"accepts":["food"]}],`+
			`"items":[{"id":"flour","width":100,"height":100,"depth":100,"weight":500,"class":"food"},`+
			`{"id":"bleach","width":100,"height":100,"depth":100,"weight":500,"class":"chemicals"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	if len(got.Boxes) != 1 {
		t.Fatalf("one box was offered and used, got %d", len(got.Boxes))
	}

	reefer := got.Boxes[0]
	if reefer.Kind != "reefer" || len(reefer.Accepts) != 1 {
		t.Errorf("the response did not say what the reefer takes: %+v", reefer)
	}

	for _, packed := range reefer.Items {
		if packed.ID != "flour" {
			t.Errorf("the reefer took %s", packed.ID)
		}
	}

	if len(got.UnfitItems) != 1 || got.UnfitItems[0].ID != "bleach" {
		t.Fatalf("the bleach should have been left behind: %+v", got.UnfitItems)
	}

	if got.UnfitItems[0].Reason != "refused by every box" {
		t.Errorf("the reason should say the box refuses it, got %q", got.UnfitItems[0].Reason)
	}
}

func TestBp3Compare_HonoursSeparation(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3CompareHandle,
		`{"boxes":[{"id":"hold","width":400,"height":400,"depth":400,"weight":100000,"quantity":2}],`+
			`"items":[{"id":"flour","width":100,"height":100,"depth":100,"weight":500,`+
			`"class":"food","separateFrom":["chemicals"]},`+
			`{"id":"bleach","width":100,"height":100,"depth":100,"weight":500,"class":"chemicals"}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var rows []struct {
		Failed bool `json:"failed"`
		Boxes  int  `json:"boxes"`
		Unfit  int  `json:"unfit"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}

	if len(rows) == 0 {
		t.Fatal("the comparison came back empty")
	}

	for _, row := range rows {
		if !row.Failed && row.Unfit == 0 && row.Boxes < 2 {
			t.Errorf("a trial packed goods that must stay apart into %d boxes", row.Boxes)
		}
	}
}

func TestBp3Handle_FewestBoxesGoalRunsWithoutNamedRules(t *testing.T) {
	t.Parallel()

	body := func(goal string) string {
		return `{"parallel":true,"goal":"` + goal + `",` +
			`"boxes":[{"id":"crate","width":300,"height":300,"depth":300,"weight":100000,"quantity":6}],` +
			`"items":[{"id":"cube","width":140,"height":140,"depth":140,"weight":10,"quantity":8}]}`
	}

	recorder := post(t, app.Bp3Handle, body("MinimizeBoxes"))
	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	used, packed := 0, 0

	for _, box := range got.Boxes {
		if len(box.Items) > 0 {
			used++
			packed += len(box.Items)
		}
	}

	if packed != 8 {
		t.Fatalf("%d of eight cubes were packed", packed)
	}

	if used != 1 {
		t.Errorf("the fewest-boxes goal used %d crates for goods that fit in one", used)
	}
}

func TestBp3Compare_ShowsTheGoalsBesideTheRules(t *testing.T) {
	t.Parallel()

	recorder := post(t, app.Bp3CompareHandle,
		`{"boxes":[{"id":"crate","width":300,"height":300,"depth":300,"weight":100000,"quantity":3}],`+
			`"items":[{"id":"cube","width":150,"height":150,"depth":150,"weight":10,"quantity":20}]}`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var rows []struct {
		Selection string `json:"selection"`
		Goal      string `json:"goal"`
		Unfit     int    `json:"unfit"`
		Failed    bool   `json:"failed"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}

	goals := map[string]int{}
	worstRule := 0
	sawRule := false

	for _, row := range rows {
		if row.Failed {
			continue
		}

		if row.Goal != "" {
			goals[row.Goal] = row.Unfit

			continue
		}

		if row.Selection != "search" {
			sawRule = true
			worstRule = max(worstRule, row.Unfit)
		}
	}

	if !sawRule {
		t.Fatal("the comparison came back without a single rule")
	}

	for _, name := range []string{"FewestBoxes", "LeastVolume", "MostItems"} {
		left, ok := goals[name]
		if !ok {
			t.Errorf("the comparison did not include %s", name)

			continue
		}

		if left > worstRule {
			t.Errorf("%s left %d behind, worse than every rule's %d", name, left, worstRule)
		}
	}
}

func settingsOrder(extra string) string {
	return `{` + extra +
		`"boxes":[{"id":"crate","width":300,"height":300,"depth":300,"weight":100000,"quantity":6}],` +
		`"items":[{"id":"cube","width":140,"height":140,"depth":140,"weight":10,"quantity":8}]}`
}

func packed(t *testing.T, body string) packResponse {
	t.Helper()

	recorder := post(t, app.Bp3Handle, body)
	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d: %s", recorder.Code, recorder.Body.String())
	}

	var got packResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}

	return got
}

func TestBp3Handle_SearchReportsWhatItSpent(t *testing.T) {
	t.Parallel()

	searched := packed(t, settingsOrder(`"search":{"nodes":64,"branching":3},`))
	if searched.Report.Nodes <= 0 {
		t.Errorf("a search ran but the report says %d states", searched.Report.Nodes)
	}

	plain := packed(t, settingsOrder(""))
	if plain.Report.Nodes != 0 {
		t.Errorf("no search ran but the report says %d states", plain.Report.Nodes)
	}
}

func TestBp3Handle_SearchCanFillForARule(t *testing.T) {
	t.Parallel()

	filled := packed(t, settingsOrder(
		`"order":"decreasing","selection":"fullest-box","search":{"nodes":64,"branching":3},"searchFills":true,`))

	if filled.Report.Algorithm == "" {
		t.Fatal("the answer names no algorithm")
	}

	if filled.Report.Nodes <= 0 {
		t.Errorf("the search filled for a rule but the report says %d states", filled.Report.Nodes)
	}

	if got := countPacked(filled); got != 8 {
		t.Errorf("%d of eight cubes were packed", got)
	}
}

func TestBp3Handle_MeritAndFinishersAreAccepted(t *testing.T) {
	t.Parallel()

	for _, merit := range []string{"contact-first", "corner-first", "residual-fit", "weighted-contact"} {
		got := packed(t, settingsOrder(`"merit":"`+merit+`",`))
		if packedItems := countPacked(got); packedItems != 8 {
			t.Errorf("merit %s packed %d of eight cubes", merit, packedItems)
		}
	}

	got := packed(t, settingsOrder(`"finishers":["Rehome","Consolidate","Rescue"],`))
	if packedItems := countPacked(got); packedItems != 8 {
		t.Errorf("the finishing passes packed %d of eight cubes", packedItems)
	}
}

func countPacked(got packResponse) int {
	packedItems := 0
	for _, box := range got.Boxes {
		packedItems += len(box.Items)
	}

	return packedItems
}

func TestBp3Meta_ServesMeritsAndFinishers(t *testing.T) {
	t.Parallel()

	recorder := httptest.NewRecorder()
	app.Bp3MetaHandle(recorder, httptest.NewRequest(http.MethodGet, "/bp3meta", nil))

	if recorder.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", recorder.Code)
	}

	var catalogue struct {
		Merits []struct {
			Value string `json:"value"`
			Label string `json:"label"`
		} `json:"merits"`
		Finishers []struct {
			Value string `json:"value"`
			Label string `json:"label"`
		} `json:"finishers"`
	}

	if err := json.Unmarshal(recorder.Body.Bytes(), &catalogue); err != nil {
		t.Fatal(err)
	}

	if len(catalogue.Merits) != 4 {
		t.Errorf("the library ships four merits, the catalogue lists %d", len(catalogue.Merits))
	}

	if len(catalogue.Finishers) != 4 {
		t.Errorf("the catalogue lists %d finishing passes", len(catalogue.Finishers))
	}

	for _, entry := range append(catalogue.Merits, catalogue.Finishers...) {
		if entry.Value == "" || entry.Label == "" {
			t.Errorf("%q is served without a label", entry.Value)
		}
	}
}
