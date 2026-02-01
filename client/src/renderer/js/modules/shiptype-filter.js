const SHIPTYPE_CATEGORIES = {
  30: { id: 'fishing', name: 'Peschereccio', icon: '🎣' },

  31: { id: 'towing', name: 'Rimorchio', icon: '⚓' },
  32: { id: 'towing', name: 'Rimorchio', icon: '⚓' },
  33: { id: 'dredging', name: 'Dragaggio', icon: '🏗️' },

  34: { id: 'diving', name: 'Operazioni subacquee', icon: '🤿' },
  35: { id: 'military', name: 'Militare', icon: '⚔️' },

  36: { id: 'sailing', name: 'Barca a vela', icon: '⛵' },
  37: { id: 'pleasure', name: 'Diporto', icon: '🛥️' },

  40: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  41: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  42: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  43: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  44: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  45: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  46: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  47: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  48: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },
  49: { id: 'hsc', name: 'Alta velocità', icon: '🚤' },

  50: { id: 'pilot', name: 'Pilotina', icon: '🚢' },
  51: { id: 'sar', name: 'SAR', icon: '🆘' },
  52: { id: 'tug', name: 'Rimorchiatore', icon: '🚢' },
  53: { id: 'port', name: 'Porto', icon: '⚓' },
  54: { id: 'antipollution', name: 'Anti-inquinamento', icon: '♻️' },
  55: { id: 'lawenforcement', name: 'Guardia Costiera', icon: '🛡️' },
  56: { id: 'local', name: 'Locale', icon: '🚢' },
  57: { id: 'local', name: 'Locale', icon: '🚢' },
  58: { id: 'medical', name: 'Medico', icon: '🏥' },
  59: { id: 'noncombatant', name: 'Non combattente', icon: '🕊️' },

  60: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  61: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  62: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  63: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  64: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  65: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  66: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  67: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  68: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },
  69: { id: 'passenger', name: 'Passeggeri', icon: '🚢' },

  70: { id: 'cargo', name: 'Cargo', icon: '📦' },
  71: { id: 'cargo', name: 'Cargo - DG A', icon: '📦' },
  72: { id: 'cargo', name: 'Cargo - DG B', icon: '📦' },
  73: { id: 'cargo', name: 'Cargo - DG C', icon: '📦' },
  74: { id: 'cargo', name: 'Cargo - DG D', icon: '📦' },
  75: { id: 'cargo', name: 'Cargo', icon: '📦' },
  76: { id: 'cargo', name: 'Cargo', icon: '📦' },
  77: { id: 'cargo', name: 'Cargo', icon: '📦' },
  78: { id: 'cargo', name: 'Cargo', icon: '📦' },
  79: { id: 'cargo', name: 'Cargo', icon: '📦' },

  80: { id: 'tanker', name: 'Tanker', icon: '🛢️' },
  81: { id: 'tanker', name: 'Tanker - DG A', icon: '🛢️' },
  82: { id: 'tanker', name: 'Tanker - DG B', icon: '🛢️' },
  83: { id: 'tanker', name: 'Tanker - DG C', icon: '🛢️' },
  84: { id: 'tanker', name: 'Tanker - DG D', icon: '🛢️' },
  85: { id: 'tanker', name: 'Tanker', icon: '🛢️' },
  86: { id: 'tanker', name: 'Tanker', icon: '🛢️' },
  87: { id: 'tanker', name: 'Tanker', icon: '🛢️' },
  88: { id: 'tanker', name: 'Tanker', icon: '🛢️' },
  89: { id: 'tanker', name: 'Tanker', icon: '🛢️' },

  90: { id: 'other', name: 'Altro', icon: '🚢' },
  91: { id: 'other', name: 'Altro', icon: '🚢' },
  92: { id: 'other', name: 'Altro', icon: '🚢' },
  93: { id: 'other', name: 'Altro', icon: '🚢' },
  94: { id: 'other', name: 'Altro', icon: '🚢' },
  95: { id: 'other', name: 'Altro', icon: '🚢' },
  96: { id: 'other', name: 'Altro', icon: '🚢' },
  97: { id: 'other', name: 'Altro', icon: '🚢' },
  98: { id: 'other', name: 'Altro', icon: '🚢' },
  99: { id: 'other', name: 'Altro', icon: '🚢' },
};

const UNKNOWN_CATEGORY = { id: 'unknown', name: 'Sconosciuto', icon: '❓' };

export class ShipTypeFilterManager {
  constructor() {
    this.categories = new Map();

    this.hiddenCategories = new Set();

    this.categoryAddedCallbacks = [];
    this.filterChangedCallbacks = [];

    this.trackCounts = new Map();
  }

  getCategoryForShiptype(shiptype) {
    if (shiptype === null || shiptype === undefined) {
      return UNKNOWN_CATEGORY;
    }
    return SHIPTYPE_CATEGORIES[shiptype] || UNKNOWN_CATEGORY;
  }

  processTrack(track) {
    const category = this.getCategoryForShiptype(track.shiptype);
    const categoryId = category.id;

    let isNewCategory = false;

    if (!this.categories.has(categoryId)) {
      this.categories.set(categoryId, {
        id: categoryId,
        name: category.name,
        icon: category.icon,
        count: 0,
        visible: true
      });
      isNewCategory = true;

      this.notifyCategoryAdded(categoryId, category);
    }

    return { categoryId, isNewCategory };
  }

  updateCounts(tracks) {
    for (const [id, cat] of this.categories) {
      cat.count = 0;
    }

    for (const track of tracks.values()) {
      const category = this.getCategoryForShiptype(track.shiptype);
      const catData = this.categories.get(category.id);
      if (catData) {
        catData.count++;
      }
    }

    this.notifyFilterChanged();
  }

  isTrackVisible(track) {
    const category = this.getCategoryForShiptype(track.shiptype);
    return !this.hiddenCategories.has(category.id);
  }

  setCategoryVisible(categoryId, visible) {
    if (visible) {
      this.hiddenCategories.delete(categoryId);
    } else {
      this.hiddenCategories.add(categoryId);
    }

    const catData = this.categories.get(categoryId);
    if (catData) {
      catData.visible = visible;
    }

    this.notifyFilterChanged();
  }

  getCategories() {
    return Array.from(this.categories.values()).sort((a, b) => b.count - a.count);
  }

  getCategoryCount() {
    return this.categories.size;
  }

  getHiddenCategories() {
    return this.hiddenCategories;
  }

  showAll() {
    this.hiddenCategories.clear();
    for (const cat of this.categories.values()) {
      cat.visible = true;
    }
    this.notifyFilterChanged();
  }

  hideAll() {
    for (const cat of this.categories.values()) {
      this.hiddenCategories.add(cat.id);
      cat.visible = false;
    }
    this.notifyFilterChanged();
  }

  onCategoryAdded(callback) {
    this.categoryAddedCallbacks.push(callback);
  }

  onFilterChanged(callback) {
    this.filterChangedCallbacks.push(callback);
  }

  notifyCategoryAdded(categoryId, category) {
    for (const cb of this.categoryAddedCallbacks) {
      cb(categoryId, category);
    }
  }

  notifyFilterChanged() {
    for (const cb of this.filterChangedCallbacks) {
      cb(this.getCategories(), this.hiddenCategories);
    }
  }

  clear() {
    this.categories.clear();
    this.hiddenCategories.clear();
    this.notifyFilterChanged();
  }
}

export const shipTypeFilter = new ShipTypeFilterManager();
