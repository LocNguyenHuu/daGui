// @flow
import React, {Component} from 'react';
import { connect } from 'react-redux';
import joint from 'jointjs';
import Immutable from 'immutable';
import {hashGraph, normalizeGraph} from 'graph/graphToolkit.js';
import CodeBuilder from 'graph/CodeBuilder';

// Enums
import ErrorType from 'shared/enums/ErrorType';
import ErrorLevel from 'shared/enums/ErrorLevel';
import HighlightType, {classTranslation as highlightTypeClasses} from 'shared/enums/HighlightType';
import HighlightDestination, {values as HighlightDestinations} from 'shared/enums/HighlightDestination';

import {updateNode, updateVariable} from 'shared/actions/graph';
import {switchTab} from 'shared/actions/file';

// Components
import ToggleDisplay from 'react-toggle-display';
import Menu from '../components/layout/Menu';
import Tabs from '../components/layout/Tabs';
import Footer from '../components/layout/Footer';
import NodesSidebar from '../components/sidebar_node/NodesSidebar';
import DetailSidebar from '../components/sidebar_detail/DetailSidebar';
import Canvas from '../components/editor/Canvas';
import CodeView from '../components/editor/CodeView';

class App extends Component {
  constructor(props){
    super(props);

    const highlights = {};
    for(let val of HighlightDestinations){
      highlights[val] = [];
    }
    this.highlightsTemplate = Immutable.fromJS(highlights);

    this.state = {
      highlights: this.highlightsTemplate
    };

    this.codeBuilder = new CodeBuilder();
    this.graphErrors = [];
    this.graphHash = null;
    this.addHighlight = this.addHighlight.bind(this);
    this.removeHighlight = this.removeHighlight.bind(this);
    this.changeTab = this.changeTab.bind(this);
  }

  changeTab(newIndex){
    this.setState({highlights: this.highlightsTemplate});
    this.props.onTabChange(newIndex);
    this.graphHash = null;
  }

  addHighlight(nid, type, destination){
    this.setState({ highlights: this.state.highlights.set(destination, this.state.highlights.get(destination).push({nid, type})) })
  }

  removeHighlight(nid, type, destination){
    this.setState({ highlights: this.state.highlights.set(destination, this.state.highlights.get(destination).filter(highlight => highlight.nid !== nid || highlight.type !== type )) })
  }

  resetHighlights(){
    this.setState({highlights: this.highlightsTemplate});
  }

  componentWillReceiveProps(nextProps){
    if(!nextProps.showCodeView)
      return; // Generation will only happen when has to (eq. when CodeView is active)

    const currentFile = nextProps.files.get(nextProps.currentFileIndex);
    const adapter = currentFile.get('adapter');
    const language = currentFile.get('language');
    const graph = currentFile.get('graph').toJS();
    const usedVariables = currentFile.get('usedVariables').toJS();

    const {normalizedGraph, inputs}= normalizeGraph(graph, adapter.isTypeInput);
    const newHash = hashGraph(normalizedGraph);
    if(this.graphHash == newHash)
      return; // No graph's changes which are connected with code ===> don't re-generate the code
    this.graphHash = newHash;

    // TODO: Optimalization - drop JointJS graph dependency (use only normalized graph)
    const jointGraph = new joint.dia.Graph();
    jointGraph.fromJSON(graph);
    let tmpErrors = adapter.validateGraph(jointGraph, normalizedGraph, inputs, language);


    if (!tmpErrors.length) {
      try {
        adapter.generateCode(this.codeBuilder, normalizedGraph, inputs, usedVariables, language);
      } catch (e){
        if(e.name == 'CircularDependency'){
          tmpErrors = [
            {
              id: null,
              type: ErrorType.DEPENDENCIES_CYCLE,
              description: e.message,
              level: ErrorLevel.ERROR,
              importance: 10
            }
          ]
        }else{
          throw e;
        }
      }

      if(this.graphErrors.length && !tmpErrors.length){
        this.setState({highlights: []});
      }
      this.graphErrors = tmpErrors;
    }else{
      this.graphErrors = tmpErrors;
      this.highlightErrors();
    }

  }

  highlightErrors(){
    const errHighlights = [];
    for(let err of this.graphErrors){
      if(err.id){
        errHighlights.push({nid: err.id, type: HighlightType.ERROR, destination: HighlightDestination.CANVAS})
      }
    }

    this.setState({highlights: errHighlights});
  }

  render() {
    const currentFile = this.props.files.get(this.props.currentFileIndex);
    const adapter = currentFile.get('adapter');
    const language = currentFile.get('language');

    // TODO: [Low] Convert toggeling visibility for DetailSidebar also into ToggleDisplay component (needs to have ability of updating state)
    return (
      <div>
        <Menu />
        <NodesSidebar adapter={adapter} />
        <Tabs currentFileIndex={this.props.currentFileIndex} files={this.props.files.toJS()} onTabChange={this.changeTab}/>
        <Canvas onAddHighlight={this.addHighlight} onRemoveHighlight={this.removeHighlight} highlights={this.state.highlights.get(HighlightDestination.CANVAS)}/>
        {this.props.nodeDetail && <DetailSidebar node={this.props.nodeDetail.toJS()} language={language} adapter={adapter} onNodeChange={this.props.onNodeChange}/>}
        <ToggleDisplay show={this.props.showCodeView}><CodeView onAddHighlight={this.addHighlight} onRemoveHighlight={this.removeHighlight} highlights={this.state.highlights.get(HighlightDestination.CODE_VIEW)} language={language} codeBuilder={this.codeBuilder} errors={this.graphErrors} onVariableNameChange={this.props.onVariableChange}/></ToggleDisplay>
        <Footer messages={this.graphErrors} framework={adapter.getName()} language={currentFile.get('language').getName()}/>
      </div>
    );
  }
}
const mapStateToProps = (state) => {
  const nodeId = state.getIn(['ui', 'detailNodeId']);
  const activeFile = state.getIn(['files', 'active']);

  return {
    currentFileIndex: state.getIn(['files', 'active']),
    files: state.getIn(['files', 'opened']),
    nodeDetail: (nodeId ? state.getIn(['files', 'opened', activeFile, 'graph', 'cells']).find(node => node.get('id') == nodeId) : null),
    showCodeView: state.getIn('ui.showCodeView'.split('.')),
  };
};

const mapDispatchToProps = (dispatch) => {
  return {
    onNodeChange: (node) => dispatch(updateNode(node)),
    onVariableChange: (nid, newVariableName) => dispatch(updateVariable(nid, newVariableName)),
    onTabChange: (newIndex) => dispatch(switchTab(newIndex))
  };
};

export default connect(mapStateToProps, mapDispatchToProps)(App);
