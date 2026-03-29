# Shared Design System

This directory contains the shared CSS and design system used across all tools in the myTools suite.

## Structure

```
shared/
├── shared-styles.css     # Complete design system with all components
└── README.md            # This file
```

## Usage

### For Static HTML Tools
```html
<link rel="stylesheet" href="../shared/shared-styles.css">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
```

### For Flask/Web Applications
```html
<!-- Use relative path from templates directory -->
<link rel="stylesheet" href="../../shared/shared-styles.css">
```

## Design System Features

### CSS Variables
- `--primary-color`: #2c3e50
- `--secondary-color`: #3498db
- `--success-color`: #27ae60
- `--warning-color`: #f39c12
- `--error-color`: #e74c3c

### Layout Components
- `.container` - Main page container
- `.header` - Page header with branding
- `.main-content` - Main content area
- `.footer` - Footer content

### Grid Systems
- `.grid-2` - Two-column grid
- `.grid-3` - Three-column responsive grid
- `.grid-4` - Four-column responsive grid

### Cards
- `.card` - Basic card container
- `.card-header` - Card header with title
- `.tool-card` - Special cards for tool links on landing page

### Forms
- `.form-input`, `.form-textarea`, `.form-select` - Form elements
- `.option-group` - Option grouping with labels
- `.file-input-container` - File upload styling

### Buttons
- `.btn` - Base button class
- `.btn-primary`, `.btn-success`, `.btn-warning` - Color variants
- `.btn-large`, `.btn-small` - Size variants

### Status & Results
- `.status-message` - Info/success/error messages
- `.progress-bar`, `.progress-fill` - Progress indicators
- `.results-container` - Results display area
- `.error-container` - Error display

### Navigation
- `.breadcrumb` - Breadcrumb navigation
- Tool cards automatically link back to index

## Adding New Tools

1. Create your tool directory in `/opt/containerd/myTools/`
2. Link to the shared CSS: `../shared/shared-styles.css`
3. Include FontAwesome: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css`
4. Add breadcrumb navigation back to main index
5. Update main `index.html` to include your new tool

## Consistency Guidelines

- Use semantic HTML5 elements (`header`, `main`, `footer`)
- Include appropriate FontAwesome icons
- Follow the card-based layout pattern
- Use CSS variables for colors
- Maintain responsive design with provided grid classes
- Include breadcrumb navigation for easy navigation

## Main Index

The main landing page is at `/opt/containerd/myTools/index.html` and showcases all available tools with:
- Tool cards with descriptions and feature lists
- Consistent branding and navigation
- Responsive grid layout
- Professional presentation

This design system ensures all tools have a consistent, professional appearance and user experience.