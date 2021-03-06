// @flow
import React, {Component} from 'react';
import CodeMarker, {values as CodeMarkerValues} from 'shared/enums/CodeMarker';

import ace from 'brace';
import 'brace/theme/clouds_midnight';
const event = ace.acequire('ace/lib/event');
const Range = ace.acequire('ace/range').Range;

import levels, {classTranslation, textTranslation} from 'shared/enums/ErrorLevel';
import HighlightTypes, {classTranslation as highlightTypeClasses} from 'shared/enums/HighlightType';
import HighlightDestination from 'shared/enums/HighlightDestination';

import Resizable from 'renderer/components/utils/Resizable';
import styles from './CodeView.scss';
import cssVariables from '!!sass-variable-loader!renderer/variables.scss';

const tabsHeight = parseInt(cssVariables.tabsHeight);
const menuHeight = parseInt(cssVariables.menuHeight);

function before(obj, method, wrapper) {
  const orig = obj[method];
  obj[method] = function() {
    const args = Array.prototype.slice.getCallback(arguments);
    return wrapper.getCallback(this, function(){
      return orig.apply(obj, args);
    }, args);
  };

  return obj[method];
}

// TODO: [BUG/High] - When modifying the variable, if the cursor is on the end of the variable box, then changes are not observed
export default class CodeView extends Component {

  constructor(props){
    super(props);

    this.editor = null;
    this.shouldUpdateWithNextChange = true;
    this.codeViewHighlights = {};
    this.onResize = this.onResize.bind(this);
  }

  hookMarkers(codeMarkers) {
    const session = this.editor.getSession();

    this.removeMarkers();
    this.resetRanges();

    let rangeTmp;
    for(let codeMarker of codeMarkers){
      rangeTmp = new Range(codeMarker.lineStart, codeMarker.charStart, codeMarker.lineEnd, codeMarker.charEnd);

      rangeTmp.start = session.doc.createAnchor(rangeTmp.start);
      rangeTmp.end = session.doc.createAnchor(rangeTmp.end);
      rangeTmp.end.$insertRight = true;

      if(codeMarker.type == CodeMarker.VARIABLE){
        session.addMarker(rangeTmp, styles.variable, codeMarker.type);
        rangeTmp.end.on('change', this.onAnchorChange.bind(this));
      }else if(codeMarker.type == CodeMarker.NODE){
        session.addMarker(rangeTmp, styles.node + ' nid-' + codeMarker.nid, codeMarker.type);
      }

      this.markers[codeMarker.type][codeMarker.nid] = rangeTmp;
    }
  }

  onAnchorChange(e) {
    const intersectedNid = this.intersects(CodeMarker.VARIABLE);

    // TODO: [Q] Old condition - does it make sense? What about editing first line?
    if (intersectedNid && (e.old.column != 0 && e.old.row != 0 && e.value.column != 0 && e.value.row != 0)) {
      const newVariableName = this.editor.getSession().doc.getTextRange(this.markers[CodeMarker.VARIABLE][intersectedNid]);
      this.shouldUpdateWithNextChange = false;
      this.props.onVariableNameChange(intersectedNid, newVariableName); // TODO: [Medium] Validation of variable name
    }
  }

  componentDidMount(){
    const aceMode = (this.props.language ? this.props.language.getAceName() : 'java');
    require('brace/mode/' + aceMode);

    this.editor = ace.edit('aceCodeEditor');
    const session = this.editor.getSession();
    session.setMode('ace/mode/' + aceMode);
    this.editor.$blockScrolling = Infinity;
    this.editor.setTheme('ace/theme/clouds_midnight');
    this.editor.setValue(this.props.codeBuilder.getCode());
    this.editor.clearSelection();
    this.hookMarkers(this.props.codeBuilder.getMarkers());

    // Highlighting nodes
    this.onMouseOver = this.onMouseOver.bind(this);
    this.onMouseOut = this.onMouseOut.bind(this);
    this.container.addEventListener('mouseover', this.onMouseOver);
    this.container.addEventListener('mouseout', this.onMouseOut);


    // Nodes under cursor highlighting
    session.selection.on('changeCursor', () => {
      const nid = this.intersects(CodeMarker.NODE);

      if(this.codeViewHighlights.active == nid) return;

      // Highlighting
      if(this.codeViewHighlights.active != null) { // Have to remove old highlight
        this.props.onRemoveHighlight(this.codeViewHighlights.active, HighlightTypes.ACTIVE, HighlightDestination.CANVAS);
      }
      if(nid){ // Adding new highlight
        this.props.onAddHighlight(nid, HighlightTypes.ACTIVE, HighlightDestination.CANVAS);
      }
      this.codeViewHighlights.active = nid;

      // Markers
      this.removeMarkers(CodeMarker.ACTIVE);
      if(nid){
        session.addMarker(this.markers[CodeMarker.NODE][nid], styles.nodeActive, CodeMarker.ACTIVE);
      }
    });

    // Enable editting only variable names
    this.editor.keyBinding.addKeyboardHandler({
      handleKeyboard : (data, hash, keyString, keyCode, event) => {
        if (hash === -1 || (keyCode <= 40 && keyCode >= 37)) return false;

        if (!this.intersects(CodeMarker.VARIABLE)) {
          return {command:"null", passEvent:false};
        }
      }
    });
    before(this.editor, 'onPaste', this.preventReadonly.bind(this));
    before(this.editor, 'onCut', this.preventReadonly.bind(this));

  }

  componentWillUpdate(nextProps) {
    // TODO: [Medium] Think of some better way how to handle changes in components from which the actions originate
    if (this.shouldUpdateWithNextChange && nextProps.codeBuilder.didCodeChanged()) {
      this.editor.setValue(nextProps.codeBuilder.getCode());
      this.hookMarkers(nextProps.codeBuilder.getMarkers());
      this.editor.clearSelection();
      this.shouldUpdateWithNextChange = true;
    }

    if ((!this.props.language && nextProps.language) || (this.props.language && nextProps.language && this.props.language.getId() != nextProps.language.getId())){
      const aceMode = nextProps.language.getAceName();
      require('brace/mode/' + aceMode);
      this.editor.getSession().setMode('ace/mode/' + aceMode);
    }

    this.highlights(nextProps.highlights);
    this.editor.resize(true);
  }

  componentWillUnmount(){
    this.container.removeEventListener('mouseover', this.onMouseOver);
    this.container.removeEventListener('mouseout', this.onMouseOut);
  }

  render() {
    return (
      <Resizable class={styles.container} side={"top"} getMax={this.getMaxHeight} onResize={this.onResize}>
        {this.renderErrors()}
        <div className={styles.codeEditor} id="aceCodeEditor" ref={(container) => {this.container = container}}></div>
      </Resizable>
    );
  }

  // TODO: [Q] Does it make sense to have multiple highlights? Mostly hover, but in future branch highlighting?
  highlights(highlights){
    this.removeMarkers(CodeMarker.HOVER); // TODO: Only hover?

    if(highlights.isEmpty()) return; // Nothing to highlight

    highlights.forEach(highlight => {
      const range = this.markers[CodeMarker.NODE][highlight.nid];
      this.editor.getSession().addMarker(range, styles[highlightTypeClasses[highlight.type]], CodeMarker.HOVER);
    });
  }

  onMouseOver(e){
    const target = e.target;

    if(!target.classList.contains(styles.node)) return e.stopPropagation();

    const regex = /nid-([\w-]*)/;
    const nid = regex.exec(target.className)[1];
    this.props.onAddHighlight(nid, HighlightTypes.HOVER, HighlightDestination.CANVAS)
  }

  onMouseOut(e){
    const target = e.target;

    if(!target.classList.contains(styles.node)) return e.stopPropagation();

    const regex = /nid-([\w-]*)/;
    const nid = regex.exec(target.className)[1];
    this.props.onRemoveHighlight(nid, HighlightTypes.HOVER, HighlightDestination.CANVAS)
  }

  renderErrors(){
    if(!this.props.errors || !this.props.errors.length) return;

    const orderedErrors = this.props.errors.sort((a, b) => b.importance - a.importance);
    const detailedErrors = orderedErrors.map((err, index) =>  (
      <div key={index} className={styles[classTranslation[err.level]]}><strong>{textTranslation[err.level]}:</strong> {err.description}</div>
    ));

    return (<div className={styles.errorsOverlay}>
      <h3>Errors found!</h3>
      {detailedErrors}
      </div>)
  }

  resetRanges(){
    if(this.markers){
      const variableMarkers = this.markers[CodeMarker.VARIABLE];
      for(let nid in variableMarkers){
        if(!variableMarkers.hasOwnProperty(nid)) continue;
        variableMarkers[nid].start.detach();
        variableMarkers[nid].end.detach();
      }
    }

    this.markers = {};
    this.markers[CodeMarker.VARIABLE] = {};
    this.markers[CodeMarker.NODE] = {};
  }

  intersects(type, withRange = this.editor.getSelectionRange()) {
    const markersGroup = this.markers[type];
    for(let nid in markersGroup){
      if(!markersGroup.hasOwnProperty(nid)) continue;
      if(withRange.intersects(markersGroup[nid])) return nid;
    }

    return null;
  }

  preventReadonly(next, args) {
    if (!this.intersects(CodeMarker.VARIABLE)) return;
    next();
  }

  removeMarkers(type){
    const session = this.editor.getSession();
    const currentMarkers = session.getMarkers();
    for(let index in currentMarkers){
      if(currentMarkers.hasOwnProperty(index) &&
          ((!type && CodeMarkerValues.includes(currentMarkers[index].type)) || currentMarkers[index].type == type)){
        session.removeMarker(currentMarkers[index].id);
      }
    }
  }

  getMaxHeight(){
    return document.documentElement.clientHeight - tabsHeight - menuHeight;
  }

  onResize(){
    this.editor.resize(true);
    setTimeout(()=> this.hookMarkers(this.props.codeBuilder.getMarkers()), 1000);
  }
}

CodeView.propTypes = {
  onVariableNameChange: React.PropTypes.func.isRequired,
  onAddHighlight: React.PropTypes.func.isRequired,
  onRemoveHighlight: React.PropTypes.func.isRequired,
  codeBuilder: React.PropTypes.object.isRequired,
  language: React.PropTypes.func,
  errors: React.PropTypes.array,
  highlights: React.PropTypes.oneOfType([React.PropTypes.array, React.PropTypes.object])
};
