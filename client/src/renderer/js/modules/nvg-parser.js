export class NVGParser {
  constructor() {
    this.circleSegments = 64;
  }

  parse(nvgString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(nvgString, 'application/xml');

    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Invalid NVG XML: ' + parseError.textContent);
    }

    const root = doc.documentElement;
    if (root.tagName.toLowerCase() !== 'nvg') {
      throw new Error('Invalid NVG: Root element must be <nvg>');
    }

    const features = [];

    this.parseChildren(root, features);

    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  parseChildren(parent, features) {
    for (const child of parent.children) {
      const feature = this.parseElement(child);
      if (feature) {
        if (Array.isArray(feature)) {
          features.push(...feature);
        } else {
          features.push(feature);
        }
      }

      if (child.tagName.toLowerCase() === 'g' || child.tagName.toLowerCase() === 'group') {
        this.parseChildren(child, features);
      }
    }
  }

  parseElement(element) {
    const tagName = element.tagName.toLowerCase();

    switch (tagName) {
      case 'point':
        return this.parsePoint(element);
      case 'polyline':
        return this.parsePolyline(element);
      case 'polygon':
        return this.parsePolygon(element);
      case 'circle':
        return this.parseCircle(element);
      case 'ellipse':
        return this.parseEllipse(element);
      case 'text':
        return this.parseText(element);
      case 'multipoint':
        return this.parseMultipoint(element);
      case 'arc':
        return this.parseArc(element);
      case 'corridor':
        return this.parseCorridor(element);
      case 'arrow':
        return this.parseArrow(element);
      case 'rect':
      case 'rectangle':
        return this.parseRectangle(element);
      default:
        return null;
    }
  }

  parsePoint(element) {
    const x = parseFloat(element.getAttribute('x'));
    const y = parseFloat(element.getAttribute('y'));

    if (isNaN(x) || isNaN(y)) {
      console.warn('NVG: Invalid point coordinates');
      return null;
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [x, y]
      },
      properties: this.extractProperties(element)
    };
  }

  parsePolyline(element) {
    const coordinates = this.extractCoordinates(element);

    if (coordinates.length < 2) {
      console.warn('NVG: Polyline needs at least 2 points');
      return null;
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: this.extractProperties(element)
    };
  }

  parsePolygon(element) {
    const coordinates = this.extractCoordinates(element);

    if (coordinates.length < 3) {
      console.warn('NVG: Polygon needs at least 3 points');
      return null;
    }

    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      coordinates.push([...first]);
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      },
      properties: this.extractProperties(element)
    };
  }

  parseCircle(element) {
    const cx = parseFloat(element.getAttribute('cx') || element.getAttribute('x'));
    const cy = parseFloat(element.getAttribute('cy') || element.getAttribute('y'));
    const r = parseFloat(element.getAttribute('r') || element.getAttribute('radius'));

    if (isNaN(cx) || isNaN(cy) || isNaN(r)) {
      console.warn('NVG: Invalid circle parameters');
      return null;
    }

    const rDegLat = r / 111000;
    const rDegLon = r / (111000 * Math.cos(cy * Math.PI / 180));

    const coordinates = [];
    for (let i = 0; i <= this.circleSegments; i++) {
      const angle = (i / this.circleSegments) * 2 * Math.PI;
      coordinates.push([
        cx + rDegLon * Math.cos(angle),
        cy + rDegLat * Math.sin(angle)
      ]);
    }

    const props = this.extractProperties(element);
    props.nvgType = 'circle';
    props.radius = r;

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      },
      properties: props
    };
  }

  parseEllipse(element) {
    const cx = parseFloat(element.getAttribute('cx') || element.getAttribute('x'));
    const cy = parseFloat(element.getAttribute('cy') || element.getAttribute('y'));
    const rx = parseFloat(element.getAttribute('rx') || element.getAttribute('radiusx'));
    const ry = parseFloat(element.getAttribute('ry') || element.getAttribute('radiusy'));
    const rotation = parseFloat(element.getAttribute('rotation') || '0');

    if (isNaN(cx) || isNaN(cy) || isNaN(rx) || isNaN(ry)) {
      console.warn('NVG: Invalid ellipse parameters');
      return null;
    }

    const rxDeg = rx / (111000 * Math.cos(cy * Math.PI / 180));
    const ryDeg = ry / 111000;
    const rotRad = rotation * Math.PI / 180;

    const coordinates = [];
    for (let i = 0; i <= this.circleSegments; i++) {
      const angle = (i / this.circleSegments) * 2 * Math.PI;
      const px = rxDeg * Math.cos(angle);
      const py = ryDeg * Math.sin(angle);
      coordinates.push([
        cx + px * Math.cos(rotRad) - py * Math.sin(rotRad),
        cy + px * Math.sin(rotRad) + py * Math.cos(rotRad)
      ]);
    }

    const props = this.extractProperties(element);
    props.nvgType = 'ellipse';
    props.radiusX = rx;
    props.radiusY = ry;
    props.rotation = rotation;

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      },
      properties: props
    };
  }

  parseText(element) {
    const x = parseFloat(element.getAttribute('x'));
    const y = parseFloat(element.getAttribute('y'));
    const text = element.textContent || element.getAttribute('label') || '';

    if (isNaN(x) || isNaN(y)) {
      console.warn('NVG: Invalid text coordinates');
      return null;
    }

    const props = this.extractProperties(element);
    props.text = text;
    props.nvgType = 'text';

    return {
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [x, y]
      },
      properties: props
    };
  }

  parseMultipoint(element) {
    const coordinates = this.extractCoordinates(element);

    if (coordinates.length === 0) {
      console.warn('NVG: Empty multipoint');
      return null;
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'MultiPoint',
        coordinates: coordinates
      },
      properties: this.extractProperties(element)
    };
  }

  parseArc(element) {
    const cx = parseFloat(element.getAttribute('cx') || element.getAttribute('x'));
    const cy = parseFloat(element.getAttribute('cy') || element.getAttribute('y'));
    const r = parseFloat(element.getAttribute('r') || element.getAttribute('radius'));
    const startAngle = parseFloat(element.getAttribute('startangle') || '0');
    const endAngle = parseFloat(element.getAttribute('endangle') || '360');

    if (isNaN(cx) || isNaN(cy) || isNaN(r)) {
      console.warn('NVG: Invalid arc parameters');
      return null;
    }

    const rDegLat = r / 111000;
    const rDegLon = r / (111000 * Math.cos(cy * Math.PI / 180));

    const coordinates = [];
    const startRad = startAngle * Math.PI / 180;
    const endRad = endAngle * Math.PI / 180;
    const angleRange = endRad - startRad;
    const segments = Math.max(8, Math.ceil(Math.abs(angleRange) / (2 * Math.PI) * this.circleSegments));

    for (let i = 0; i <= segments; i++) {
      const angle = startRad + (i / segments) * angleRange;
      coordinates.push([
        cx + rDegLon * Math.cos(angle),
        cy + rDegLat * Math.sin(angle)
      ]);
    }

    const props = this.extractProperties(element);
    props.nvgType = 'arc';

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: props
    };
  }

  parseCorridor(element) {
    const width = parseFloat(element.getAttribute('width') || '0');
    const coordinates = this.extractCoordinates(element);

    if (coordinates.length < 2) {
      console.warn('NVG: Corridor needs at least 2 points');
      return null;
    }

    if (width > 0) {
      const polygon = this.bufferLine(coordinates, width);
      const props = this.extractProperties(element);
      props.nvgType = 'corridor';
      props.width = width;

      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [polygon]
        },
        properties: props
      };
    }

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: this.extractProperties(element)
    };
  }

  parseArrow(element) {
    const coordinates = this.extractCoordinates(element);

    if (coordinates.length < 2) {
      const x1 = parseFloat(element.getAttribute('x1') || element.getAttribute('x'));
      const y1 = parseFloat(element.getAttribute('y1') || element.getAttribute('y'));
      const x2 = parseFloat(element.getAttribute('x2'));
      const y2 = parseFloat(element.getAttribute('y2'));

      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
        coordinates.push([x1, y1], [x2, y2]);
      } else {
        console.warn('NVG: Arrow needs at least 2 points');
        return null;
      }
    }

    const props = this.extractProperties(element);
    props.nvgType = 'arrow';

    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coordinates
      },
      properties: props
    };
  }

  parseRectangle(element) {
    const x = parseFloat(element.getAttribute('x'));
    const y = parseFloat(element.getAttribute('y'));
    const width = parseFloat(element.getAttribute('width'));
    const height = parseFloat(element.getAttribute('height'));

    if (isNaN(x) || isNaN(y) || isNaN(width) || isNaN(height)) {
      console.warn('NVG: Invalid rectangle parameters');
      return null;
    }

    let w = width;
    let h = height;

    if (Math.abs(width) > 1 || Math.abs(height) > 1) {
      w = width / (111000 * Math.cos(y * Math.PI / 180));
      h = height / 111000;
    }

    const coordinates = [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
      [x, y]
    ];

    const props = this.extractProperties(element);
    props.nvgType = 'rectangle';

    return {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [coordinates]
      },
      properties: props
    };
  }

  extractCoordinates(element) {
    const coordinates = [];

    const pointsAttr = element.getAttribute('points');
    if (pointsAttr) {
      const pairs = pointsAttr.trim().split(/\s+/);
      for (const pair of pairs) {
        const [x, y] = pair.split(',').map(parseFloat);
        if (!isNaN(x) && !isNaN(y)) {
          coordinates.push([x, y]);
        }
      }
      return coordinates;
    }

    for (const child of element.children) {
      if (child.tagName.toLowerCase() === 'point') {
        const x = parseFloat(child.getAttribute('x'));
        const y = parseFloat(child.getAttribute('y'));
        if (!isNaN(x) && !isNaN(y)) {
          coordinates.push([x, y]);
        }
      }
    }

    return coordinates;
  }

  extractProperties(element) {
    const props = {};

    const attrNames = ['label', 'symbol', 'style', 'uri', 'modifiers',
                       'fill', 'stroke', 'stroke-width', 'opacity',
                       'id', 'name', 'description', 'timestamp'];

    for (const attr of attrNames) {
      const value = element.getAttribute(attr);
      if (value !== null) {
        props[attr] = value;
      }
    }

    if (props.style) {
      const styleParts = props.style.split(';');
      for (const part of styleParts) {
        const [key, value] = part.split(':').map(s => s.trim());
        if (key && value) {
          props[`style_${key}`] = value;
        }
      }
    }

    if (props.symbol) {
      props.milstdSymbol = props.symbol;
    }

    return props;
  }

  bufferLine(coords, widthMeters) {
    const leftSide = [];
    const rightSide = [];

    for (let i = 0; i < coords.length; i++) {
      const [x, y] = coords[i];

      let dx, dy;
      if (i === 0) {
        dx = coords[1][0] - coords[0][0];
        dy = coords[1][1] - coords[0][1];
      } else if (i === coords.length - 1) {
        dx = coords[i][0] - coords[i - 1][0];
        dy = coords[i][1] - coords[i - 1][1];
      } else {
        dx = coords[i + 1][0] - coords[i - 1][0];
        dy = coords[i + 1][1] - coords[i - 1][1];
      }

      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const nx = -dy / len;
      const ny = dx / len;

      const widthDegLat = (widthMeters / 2) / 111000;
      const widthDegLon = (widthMeters / 2) / (111000 * Math.cos(y * Math.PI / 180));

      leftSide.push([x + nx * widthDegLon, y + ny * widthDegLat]);
      rightSide.push([x - nx * widthDegLon, y - ny * widthDegLat]);
    }

    return [...leftSide, ...rightSide.reverse(), leftSide[0]];
  }

  async parseFile(file) {
    const text = await file.text();
    return this.parse(text);
  }
}

export const nvgParser = new NVGParser();
