import './style.css';
import { ui } from './ui.js';
import { analytics } from './analytics.js';
import { navigation } from './navigation.js';
import { documents } from './documents.js';

window.pageCallbacks = {
  'all-vessels': () => analytics.loadAggregatedVessels(),
  'conflicts': () => ui.loadConflicts(),
  'documents': () => { } // Empty - documents load on search
};

document.addEventListener('DOMContentLoaded', () => {
  ui.init();
  analytics.init();
  navigation.init();
  documents.init();
});
