# CSV Import Examples

This directory contains example CSV files for importing boxes and items into the BoxPacker3 UI.

## File Format

The CSV files use a simplified format (no ID required):
```
width;height;depth;weight;type
```

Or without type (defaults to item):
```
width;height;depth;weight
```

Where:
- `width` - Width dimension in millimeters
- `height` - Height dimension in millimeters
- `depth` - Depth dimension in millimeters
- `weight` - Weight in grams
- `type` - Type: `0` for boxes, `1` for items (optional, defaults to `1` if omitted)

## Test Cases

### `case-1-single-box.csv`
Fill one small box (220×185×50) with 5 items. Good for testing single box packing.

### `case-2-second-box.csv`
Fill one medium box (425×265×190) with 7 items. Tests medium-sized box packing.

### `case-3-third-box.csv`
Fill one large box (530×380×265) with 8 items. Tests large box packing.

### `case-4-all-boxes.csv`
Fill all three boxes (small, medium, large) with 17 items of various sizes. Tests multi-box packing scenario.

### `case-5-items-only.csv`
Items only (no boxes). Will use default boxes from the system. Format without type column.

### `case-6-challenge.csv`
Challenge case with large boxes and large items requiring careful packing strategy.

## Legacy Examples (with IDs)

These examples use the old format with IDs (still supported):

### `sample-boxes-and-items.csv`
A simple example with 3 boxes and 10 items of various sizes.

### `default-boxes.csv`
Contains all 13 default box types from BoxPacker3 with their standard dimensions and IDs.

### `sample-items-only.csv`
Contains 15 sample items of various sizes.

### `mixed-packaging.csv`
A comprehensive example with 3 boxes and 15 products.

## Usage

1. Open the BoxPacker3 UI
2. Click the "import" button
3. Select one of the CSV files from this directory
4. The boxes and items will be imported and ready for packing

## Format Support

The importer supports multiple formats:
- **Simplified**: `width;height;depth;weight;type` (5 fields)
- **Simplified (no type)**: `width;height;depth;weight` (4 fields, defaults to item)
- **With type first**: `type;width;height;depth;weight` (5 fields)
- **Legacy**: `id;width;type;height;depth;weight` (6 fields)

## Notes

- Lines starting with `#` are treated as comments
- Empty lines are skipped
- Headers are auto-detected and skipped
- IDs are automatically generated (no need to specify)
- All dimensions must be positive numbers
- Type must be exactly `0` (box) or `1` (item) if specified

