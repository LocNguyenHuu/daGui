// @flow
import React, { Component } from 'react';
import { findDOMNode } from 'react-dom';
import { connect } from 'react-redux'
import joint from 'jointjs';
import svgPanZoom from 'svg-pan-zoom'

import {countInPorts} from 'graph/graphToolkit';
import styles from "./Canvas.scss";
import HighlightTypes, {classTranslation as highlightTypeClasses} from 'shared/enums/HighlightType';
import HighlightDestination from 'shared/enums/HighlightDestination';

import {changeNodeDetail, canvasResize} from 'shared/actions/ui';
import * as graphActions from 'shared/actions/graph';

const CLICK_TRESHOLD = 2;
const VARIABLE_NAME_MAX_WIDTH = 150;
const VARIABLE_NAME_MIN_WIDTH = 30;
const GRID_SIZE = 1;

const getTextWidth = (text, font = '14px helvetica') => {
  // re-use canvas object for better performance
  const canvas = getTextWidth.canvas || (getTextWidth.canvas = document.createElement("canvas"));
  const context = canvas.getContext("2d");
  context.font = font;
  const metrics = context.measureText(text);
  return metrics.width;
};

function setGrid(paper, size, color, offset) {
  const canvas = document.createElement("canvas");
  canvas.setAttribute('width', size);
  canvas.setAttribute('height', size);

  const context = canvas.getContext('2d');
  context.beginPath();
  context.rect(1, 1, 1, 1);
  context.fillStyle = color || '#AAAAAA';
  context.fill();

  // Finally, set the grid background image of the paper container element.
  const gridBackgroundImage = canvas.toDataURL('image/png');
  paper.el.childNodes[0].style['background-image'] = 'url("' + gridBackgroundImage + '")';
  if(offset){
    paper.el.childNodes[0].style['background-position'] = offset.x + 'px ' + offset.y + 'px';
  }
}


class Canvas extends Component {

  constructor(props) {
    super(props);
    this.graph = new joint.dia.Graph();
    this.currentDetailCell = null;
    this.startingPointerPosition = null;
    this.currentHoveredNid = null;
    this.occupiedPorts = {};
    this.freezed = false;

    // TODO: [Low] Find better place to place this
    joint.setTheme('modern');
  }

  componentDidMount() {
    const wrapperElem = findDOMNode(this.refs.placeholder);

    this.paper = new joint.dia.Paper({
      el: wrapperElem,
      width: wrapperElem.offsetWidth,
      height: 1000,
      model: this.graph,
      gridSize: GRID_SIZE,

      clickThreshold: 1,
      linkPinning: false,
      markAvailable: true,
      snapLinks: { radius: 40 },
      defaultLink: new joint.dia.Link({
        attrs: { '.marker-target': { d: 'M 10 0 L 0 5 L 10 10 z' } },
        smooth: true
      }),
      validateConnection: function(cellViewS, magnetS, cellViewT, magnetT, end, linkView) {
        if (magnetS && magnetS.getAttribute('port-group') === 'in') return false;
        if (cellViewS === cellViewT) return false;
        if (!magnetT || magnetT.getAttribute('port-group') !== 'in') return false;

        const ports = this.props.$occupiedPorts.get(cellViewT.model.id);
        return !ports || !ports.has(magnetT.getAttribute('port'));
      }.bind(this)
    });
    setTimeout(this.onResize.bind(this), 10);

    this.graph.fromJSON(this.props.graphJson.toJS());

    // Event listeners
    this.paper.on('cell:mouseout', this.onMouseOut.bind(this));
    this.paper.on('cell:mouseover', this.onMouseOver.bind(this));
    this.paper.on('cell:pointerdown', this.onPointerDown.bind(this));
    this.paper.on('cell:pointerup', this.onPointerUp.bind(this));
    this.paper.on('blank:pointerclick', this.onNodeDetail.bind(this));
    this.paper.el.addEventListener('input', this.onInput.bind(this));
    this.graph.on('remove', this.removeLink.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));

    // Grid on background
    setGrid(this.paper, GRID_SIZE*15, '#808080');

    // Zooming and panning support
    this.currentScale = 1;
    this.panAndZoom = svgPanZoom(wrapperElem.childNodes[0],
      {
        viewportSelector: wrapperElem.childNodes[0].childNodes[0],
        fit: false,
        zoomScaleSensitivity: 0.4,
        panEnabled: false,
        onZoom: (scale) => {
          this.currentScale = scale;
          setGrid(this.paper, GRID_SIZE*15*this.currentScale, '#808080');
        },
        beforePan: (oldpan, newpan) =>{
          setGrid(this.paper, GRID_SIZE*15*this.currentScale, '#808080', newpan);
        }
      });

    this.paper.on('blank:pointerdown', (evt, x, y) => {
      this.panAndZoom.enablePan();
      //console.log(x + ' ' + y);
    });

    this.paper.on('cell:pointerup blank:pointerup', (cellView, event) => {
      this.panAndZoom.disablePan();
    });
  }

  componentDidUpdate(){
    // TODO: [Low] Optimalization - don't update when the action was created by graph's event or graph can be just modified
    this.graph.fromJSON(this.props.graphJson.toJS());
    this.variableNameIterator(this.graph.getElements());

    // On Blur/Focus of variable name input
    this.paper.el.querySelectorAll('input').forEach(input => {
      input.addEventListener('focus', this.onFocus.bind(this));
      input.addEventListener('blur', this.onBlur.bind(this));
      input.addEventListener('change', this.onVariableNameChange.bind(this));
    });

    if(this.props.detailNodeId){
      this.highlightNode(this.props.detailNodeId, styles.nodeDetail);
    }

    if(!this.props.highlights.isEmpty()){
      this.highlightNodes(this.props.highlights);
    }
  }

  shouldComponentUpdate(){
    return !this.freezed;
  }

  highlightNodes(highlights) {
    highlights.forEach(highlight => {
      this.highlightNode(highlight.nid, styles[highlightTypeClasses[highlight.type]])
    });
  }

  highlightNode(nid, className = styles.nodeDetail){
    const detailNode = this.graph.getCell(nid);
    const view = this.paper.findViewByModel(detailNode);
    view.highlight(view.el.querySelectorAll('rect'), {     // TODO: [Medium] Delegate returning element for highlighting to Node Template
      highlighter: {
        name: 'addClass',
        options: {
          className: className
        }
      }
    });
  }

  render() {
    return <div ref="placeholder" className={styles.container}></div>;
  }

  setVariableName(element, name){
    const parentNode = element.findView(this.paper).el;
    const input = parentNode.querySelectorAll('input')[0];
    input.value = name;

    const classList = parentNode.querySelectorAll('.variableName')[0].classList;
    classList.add.apply(classList, styles.active.split(' '));

    this.recalculateWidthOfVariableName(input);
  }

  variableNameIterator(elements){
    for(let elem of elements) {
      if(elem.attributes.dfGui.variableName){
        this.setVariableName(elem, elem.attributes.dfGui.variableName);
      }
    }
  }

  recalculateWidthOfVariableName(input){
    const width = getTextWidth(input.value) + 13;

    if(width < VARIABLE_NAME_MIN_WIDTH){
      input.parentNode.parentNode.setAttribute('width', VARIABLE_NAME_MIN_WIDTH);
    }else if(width > VARIABLE_NAME_MAX_WIDTH){
      input.parentNode.parentNode.setAttribute('width', VARIABLE_NAME_MAX_WIDTH);
    }else{
      input.parentNode.parentNode.setAttribute('width', width);
    }
  }

  addLink(cellView){
    const sourceElement = this.graph.getCell(cellView.model.attributes.source.id);
    const sourcesChildren = this.graph.getConnectedLinks(sourceElement, {outbound: true});
    if(sourcesChildren.length > 1){
      let childrenElement;
      for(let children of sourcesChildren) {
        childrenElement = this.graph.getCell(children.attributes.target.id);
        if(!childrenElement.attributes.dfGui.variableName){
          const variableName = this.props.language.nameNode(this.props.adapter.getNodeTemplates()[childrenElement.attributes.type], this.props.usedVariables);
          this.props.onUpdateVariable(childrenElement.id, variableName); // TODO: [Low] Batch adding the variable and adding link
        }
      }
    }

    this.props.onLinkAdd(cellView.model.toJSON(), cellView.model.attributes.target.id, cellView.model.attributes.target.port);
  }

  removeLink(link){
    if(link.attributes.target.id){
      const sourceElement = this.graph.getCell(link.attributes.source.id);
      const targetElement = this.graph.getCell(link.attributes.target.id);
      const sourcesChildren = this.graph.getConnectedLinks(sourceElement, {outbound: true});
      if(sourcesChildren.length == 1){ // Delete variable only when going from 2 links to 1 link
        this.props.onRemoveVariable(sourcesChildren[0].attributes.target.id);
        this.props.onRemoveVariable(targetElement.id); // TODO: [Low] Batch deleting variables
        this.props.onLinkDelete(link.id, link.attributes.target.id, link.attributes.target.port);
      }else if(targetElement.attributes.dfGui.variableName && countInPorts(targetElement) == 1) {
        this.props.onLinkDeleteAndVariable(targetElement.id, link.id, link.attributes.target.id, link.attributes.target.port);
      }else{
        this.props.onLinkDelete(link.id, link.attributes.target.id, link.attributes.target.port);
      }
    }
  }

  onResize(){
    const wrapperElem = findDOMNode(this.refs.placeholder);
    this.paper.setDimensions(wrapperElem.offsetWidth, wrapperElem.offsetHeight);
    this.props.onCanvasResize(wrapperElem.getBoundingClientRect());
  }

  onNodeMove(cellView){
    if(cellView.model.attributes.type != 'link'){
      const newPosition = cellView.model.attributes.position;
      this.props.onNodeMove(cellView.model.id, newPosition.x, newPosition.y);
    }
  }

  onNodeDetail(cellView){
    // blank:pointerclick event
    if(cellView.originalEvent){
      if(this.currentDetailCell){
        this.props.onNodeDetail(null);
        this.currentDetailCell = null;
      }

      document.querySelectorAll('input').forEach(input => input.blur());
      return;
    }

    if(cellView === this.currentDetailCell
      || cellView.model.attributes.type == 'link'){
      return;
    }

    this.currentDetailCell = cellView;
    this.props.onNodeDetail(cellView.model.id);
  }

  onInput(e){
    this.recalculateWidthOfVariableName(e.target);
  }

  onVariableNameChange(e){
    const nodeId = e.target.closest('.joint-cell').getAttribute('model-id');
    this.props.onUpdateVariable(nodeId, e.target.value)
  }

  onFocus(e){
    const node = e.target.parentNode.parentNode.parentNode;
    node.classList.add.apply(node.classList, styles.focused.split(' '));
    this.freezed = true;
  }

  onBlur(e){
    const node = e.target.parentNode.parentNode.parentNode;
    node.classList.remove.apply(node.classList, styles.focused.split(' '));
    this.freezed = false;
  }

  onMouseOut(cellView, e){
    if(!this.props.showCodeView || this.freezed) return;

    this.props.onRemoveHighlight(this.currentHoveredNid, HighlightTypes.HOVER, HighlightDestination.CODE_VIEW);
    this.currentHoveredNid = null;
  }

  onMouseOver(cellView, e){
    if(!this.props.showCodeView || cellView.model.isLink() || this.freezed) return;

    if(this.currentHoveredNid != cellView.model.id){
      // There is active Node highlighted ==> for switch have to remove the old one
      if(this.currentHoveredNid !== null) this.props.onRemoveHighlight(this.currentHoveredNid, HighlightTypes.HOVER, HighlightDestination.CODE_VIEW);

      this.props.onAddHighlight(cellView.model.id, HighlightTypes.HOVER, HighlightDestination.CODE_VIEW);
      this.currentHoveredNid = cellView.model.id;
    }
  }

  // TODO: [BUG/Medium] When dragging node Z value should be the highest in graph
  onPointerDown(cellView, e, x, y){
    this.startingPointerPosition = {x, y};
    this.freezed = true;
  }

  onPointerUp(cellView, e, x, y){
    if(!e.target || e.target.type != 'text') this.freezed = false;

    if(Math.abs(this.startingPointerPosition.x - x) < CLICK_TRESHOLD
        && Math.abs(this.startingPointerPosition.y - y) < CLICK_TRESHOLD) {
      // Click
      if(e.target && e.target.type == 'text'){ // Variable input
        e.target.focus();
      }else if(cellView.model.isElement()){
        this.onNodeDetail(cellView);
      }else if(
        cellView.model.isLink()
        && cellView.model.graph  // Needs to verify, that the click was not on remove button
      ) this.addLink(cellView)
    }else{
      // Drag node
      if(cellView.model.isElement()){
        this.onNodeMove(cellView);
      }else if(
        cellView.model.isLink()
        && cellView.model.attributes.target.id // Needs to verify, that the link is not left hanging in middle of nowhere
      ) this.addLink(cellView);
    }

    this.startingPointerPosition = null;
  }

  onKeyUp(e){
    if(e.keyCode == 46 && this.props.detailNodeId &&
      !(e.target.matches('input') || e.target.matches('[contenteditable]') || e.target.matches('textarea'))){
      const model = this.graph.getCell(this.props.detailNodeId);
      this.graph.getConnectedLinks(model, {outbound: true}).forEach(link => this.occupiedPorts[link.attributes.target.id].delete(link.attributes.target.port));

      this.props.onNodeDelete(this.props.detailNodeId);
    }
  }
}

const mapStateToProps = (state) => {
  const activeFile = state.getIn(['files', 'active']);
  return {
    language: state.getIn(['files', 'opened', activeFile, 'language']),
    usedVariables: state.getIn(['files', 'opened', activeFile, 'usedVariables']).toJS(),
    adapter: state.getIn(['files', 'opened', activeFile, 'adapter']),
    graphJson: state.getIn(['files', 'opened', activeFile, 'graph']),
    detailNodeId: state.getIn('ui.detailNodeId'.split('.')),
    showCodeView: state.getIn('ui.showCodeView'.split('.')),
    $occupiedPorts: state.getIn(['files', 'opened', activeFile, '$occupiedPorts'])
  };
};

const mapDispatchToProps = (dispatch) => {
    return {
      addLinkAndVariable: (linkObject, nid, variableName) => {
        dispatch([
          graphActions.updateVariable(nid, variableName),
          graphActions.updateNode(linkObject)
        ]);
      },
      onUpdateVariable: (nid, newVariableName) => dispatch(graphActions.updateVariable(nid, newVariableName)),
      onRemoveVariable: (nid) => dispatch(graphActions.removeVariable(nid)),
      onCanvasResize: (dimensions) => dispatch(canvasResize(dimensions)),
      onNodeMove: (nid, x, y) => dispatch(graphActions.moveNode(nid, x, y)),
      onNodeUpdate: (elementObject) => dispatch(graphActions.updateNode(elementObject)),
      onNodeDelete: (id) => {
        dispatch([
          changeNodeDetail(null),
          graphActions.deleteNode(id)
        ]);
      },
      onLinkAdd: (linkObject, targetNid, targetPort) => dispatch(graphActions.addLink(linkObject, targetNid, targetPort)),
      onLinkDelete: (lid, targetNid, targetPort) => dispatch(graphActions.removeLink(lid, targetNid, targetPort)),
      onLinkDeleteAndVariable: (nid, lid, targetNid, targetPort) => dispatch([
        graphActions.removeVariable(nid),
        graphActions.removeLink(lid, targetNid, targetPort)
      ]),
      onNodeDetail: (nid) => dispatch(changeNodeDetail(nid))
    }
};

Canvas.propTypes = {
  onAddHighlight: React.PropTypes.func.isRequired,
  onRemoveHighlight: React.PropTypes.func.isRequired,
  onSwitchHighlight: React.PropTypes.func.isRequired,
  highlights: React.PropTypes.oneOfType([React.PropTypes.array, React.PropTypes.object])
};

export default connect(mapStateToProps, mapDispatchToProps)(Canvas);
