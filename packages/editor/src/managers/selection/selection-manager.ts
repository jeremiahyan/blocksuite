import { PageContainer } from '../..';
import { Rect } from '../../components/selection-rect/rect';
import { BLOCK_ID_ATTR } from '@blocksuite/shared';
import { BaseBlockModel, IDisposable, Slot } from '@blocksuite/store';

export type SelectionInfo = InstanceType<
  typeof SelectionManager
>['selectionInfo'];

// TODO use lodash or move to utils
function without<T = unknown>(arr: Array<T>, ...values: Array<T>) {
  const toRemoveValues = Array.from(new Set(values));
  let result: Array<T> = arr;
  toRemoveValues.forEach(toRemoveValue => {
    result = result.filter(value => value !== toRemoveValue);
  });
  return result;
}

export class SelectionManager {
  private _selectedBlockIds: Array<string> = [];
  // @ts-ignore
  private _page: PageContainer;
  private _disposables: IDisposable[] = [];
  private _blockSelectSlotMap: { [k in string]: Slot<boolean> } = {};
  private _anchorBlockId = '';
  private _focusBlockId = '';
  private _slots = {
    selection: new Slot<SelectionInfo>(),
  };

  constructor(page: PageContainer) {
    this._page = page;
    this._handlerBrowserChange = this._handlerBrowserChange.bind(this);
    this._initListenBrowserSelection();
  }

  get selectedBlockIds() {
    return this._selectedBlockIds;
  }

  set selectedBlockIds(ids: Array<string>) {
    const blocksNeedUnselect = without<string>(this._selectedBlockIds, ...ids);
    const blocksNeedSelect = without<string>(ids, ...this._selectedBlockIds);
    blocksNeedUnselect.forEach(blockId => {
      this._emitBlockSelectChange(blockId, false);
    });
    blocksNeedSelect.forEach(blockId => {
      this._emitBlockSelectChange(blockId);
    });
    this._selectedBlockIds = ids;
    this._emitSelectionChange();
  }

  get type() {
    if (this._selectedBlockIds.length) {
      return 'Block';
    }
    const selection = window.getSelection();
    if (selection?.type === 'Caret' && this._anchorBlockId) {
      return 'Caret';
    }
    if (selection?.type === 'Range' && this._anchorBlockId) {
      return 'Range';
    }
    return 'None';
  }

  get selectionInfo() {
    if (this.type === 'Range' || this.type === 'Caret') {
      //TODO IMP: Do you need to pass Range and Crate directly here
      return {
        type: this.type,
        anchorBlockId: this._anchorBlockId,
        focusBlockId: this._focusBlockId,
      } as const;
    }
    if (this.type === 'Block') {
      return {
        type: 'Block',
        selectedNodesIds: this._selectedBlockIds,
      } as const;
    }
    return { type: 'None' } as const;
  }

  private _initListenBrowserSelection() {
    document.addEventListener('selectionchange', this._handlerBrowserChange);
  }

  private _handlerBrowserChange() {
    const selection = window.getSelection();
    this.selectedBlockIds = [];
    if (selection) {
      const { type, anchorNode, focusNode } = selection;
      if (
        type !== 'None' &&
        anchorNode &&
        focusNode &&
        this._page.contains(anchorNode) &&
        this._page.contains(focusNode)
      ) {
        const anchorBlockId =
          anchorNode.parentElement
            ?.closest(`[${BLOCK_ID_ATTR}]`)
            ?.getAttribute(BLOCK_ID_ATTR) || '';
        const focusBlockId =
          focusNode.parentElement
            ?.closest(`[${BLOCK_ID_ATTR}]`)
            ?.getAttribute(BLOCK_ID_ATTR) || '';
        this._anchorBlockId = anchorBlockId;
        this._focusBlockId = focusBlockId;
      }
    } else {
      this._anchorBlockId = '';
      this._focusBlockId = '';
    }
    this._emitSelectionChange();
  }

  public calcIntersectBlocks(selectionRect: Rect, blockModel: BaseBlockModel) {
    let selectedBlocks: Array<string> = [];
    const blockDom = this._page.querySelector(
      `[${BLOCK_ID_ATTR}='${blockModel.id}']`
    );
    if (blockDom) {
      if (selectionRect.isIntersect(Rect.fromDom(blockDom))) {
        const { children } = blockModel;
        const queryStr = children.reduce((query, child, index) => {
          return `${query}${index ? ',' : ''}[${BLOCK_ID_ATTR}='${child.id}']`;
        }, '');
        // IMP: if parent block does not contain child block, this will be not useful
        const childrenDoms = blockDom.querySelectorAll(queryStr);
        childrenDoms.forEach(dom => {
          if (selectionRect.isIntersect(Rect.fromDom(dom))) {
            const id = dom.attributes.getNamedItem(BLOCK_ID_ATTR)?.value;
            id && selectedBlocks.push(id);
          }
        });
        // if selected only one block check if select children
        if (selectedBlocks.length === 1) {
          const selectedBlockModel = children.find(
            children => children.id === selectedBlocks[0]
          );
          if (selectedBlockModel && selectedBlockModel.children.length) {
            const selectedChildren = this.calcIntersectBlocks(
              selectionRect,
              selectedBlockModel
            );
            if (selectedChildren.length) {
              selectedBlocks = selectedChildren;
            }
          }
        }
      }
    }
    // only page model need call selection change
    if (this._page.model === blockModel) {
      this.selectedBlockIds = selectedBlocks;
    }
    return selectedBlocks;
  }

  private _getBlockSelectSlot(blockId: string) {
    let slot = this._blockSelectSlotMap[blockId];
    if (!slot) {
      slot = new Slot();
      this._blockSelectSlotMap[blockId] = slot;
    }
    return slot;
  }

  public addChangeListener(
    blockId: string,
    handler: (selected: boolean) => void
  ) {
    const slot = this._getBlockSelectSlot(blockId);
    const disposables = slot.on(handler);
    this._disposables.push(slot.on(handler));
    return disposables;
  }

  public removeChangeListener(blockId: string) {
    const slot = this._blockSelectSlotMap[blockId];
    if (slot) {
      slot.dispose();
    }
    return delete this._blockSelectSlotMap[blockId];
  }

  private _emitBlockSelectChange(blockId: string, selected = true) {
    const slot = this._blockSelectSlotMap[blockId];
    if (slot) {
      slot.emit(selected);
    }
  }

  public onSelectionChange(handler: (selectionInfo: SelectionInfo) => void) {
    return this._slots.selection.on(handler);
  }

  private _emitSelectionChange() {
    this._slots.selection.emit(this.selectionInfo);
  }

  public dispose() {
    window.removeEventListener('selectionchange', this._handlerBrowserChange);
    Object.values(this._blockSelectSlotMap).forEach(slot => slot.dispose());
    Object.values(this._slots).forEach(slot => slot.dispose());
  }
}
