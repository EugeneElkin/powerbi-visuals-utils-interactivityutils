/*
 *  Power BI Visualizations
 *
 *  Copyright (c) Microsoft Corporation
 *  All rights reserved.
 *  MIT License
 *
 *  Permission is hereby granted, free of charge, to any person obtaining a copy
 *  of this software and associated documentation files (the ""Software""), to deal
 *  in the Software without restriction, including without limitation the rights
 *  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *  copies of the Software, and to permit persons to whom the Software is
 *  furnished to do so, subject to the following conditions:
 *
 *  The above copyright notice and this permission notice shall be included in
 *  all copies or substantial portions of the Software.
 *
 *  THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *  THE SOFTWARE.
 */

module powerbi.extensibility.utils.interactivity {
    // powerbi.extensibility
    import IVisualHost = powerbi.extensibility.visual.IVisualHost;
    import ISelectionManager = powerbi.extensibility.ISelectionManager;
    import ExtensibilityISelectionId = powerbi.extensibility.ISelectionId;

    // powerbi.visuals
    import ISelectionId = powerbi.visuals.ISelectionId;

    // powerbi.extensibility.utils.type
    import ArrayExtensions = powerbi.extensibility.utils.type.ArrayExtensions;

    // powerbi.extensibility.utils.svg
    import BoundingRect = powerbi.extensibility.utils.svg.shapes.BoundingRect;

    export interface SelectableDataPoint {
        selected: boolean;
        /** Identity for identifying the selectable data point for selection purposes */
        identity: ExtensibilityISelectionId;
        /**
         * A specific identity for when data points exist at a finer granularity than
         * selection is performed.  For example, if your data points should select based
         * only on series even if they exist as category/series intersections.
         */
        specificIdentity?: ExtensibilityISelectionId;
    }

    /**
     * Factory method to create an IInteractivityService instance.
     */
    export function createInteractivityService(hostServices: IVisualHost): IInteractivityService {
        return new InteractivityService(hostServices);
    }

    /**
    * Creates a clear an svg rect to catch clear clicks.
    */
    export function appendClearCatcher(selection: d3.Selection<any>): d3.Selection<any> {
        return selection
            .append("rect")
            .classed("clearCatcher", true)
            .attr({ width: "100%", height: "100%" });
    }

    export function dataHasSelection(data: SelectableDataPoint[]): boolean {
        for (let i = 0, ilen = data.length; i < ilen; i++) {
            if (data[i].selected)
                return true;
        }
        return false;
    }

    export interface IInteractiveBehavior {
        bindEvents(behaviorOptions: any, selectionHandler: ISelectionHandler): void;
        renderSelection(hasSelection: boolean): void;

        hoverLassoRegion?(e: MouseEvent, rect: BoundingRect): void;
        lassoSelect?(e: MouseEvent, rect: BoundingRect): void;
    }

    /**
     * An optional options bag for binding to the interactivityService
     */
    export interface InteractivityServiceOptions {
        isLegend?: boolean;
        isLabels?: boolean;
        overrideSelectionFromData?: boolean;
        hasSelectionOverride?: boolean;
    }

    /**
     * Responsible for managing interactivity between the hosting visual and its peers
     */
    export interface IInteractivityService {
        /** Binds the visual to the interactivityService */
        bind(dataPoints: SelectableDataPoint[], behavior: IInteractiveBehavior, behaviorOptions: any, iteractivityServiceOptions?: InteractivityServiceOptions);

        /** Clears the selection */
        clearSelection(): void;

        /** Sets the selected state on the given data points. */
        applySelectionStateToData(dataPoints: SelectableDataPoint[], hasHighlights?: boolean): boolean;

        /** Checks whether there is at least one item selected */
        hasSelection(): boolean;

        /** Checks whether there is at least one item selected within the legend */
        legendHasSelection(): boolean;

        /** Checks whether the selection mode is inverted or normal */
        isSelectionModeInverted(): boolean;

        /** Apply new selections to change internal state of interactivity service from filter */
        applySelectionFromFilter(appliedFilter: filter.AppliedFilter): void;

        /** Apply new selections to change internal state of interactivity service */
        restoreSelection(selectionIds: ISelectionId[]): void;
    }

    export interface ISelectionHandler {
        /**
         * Handles a selection event by selecting the given data point.  If the data point's
         * identity is undefined, the selection state is cleared. In this case, if specificIdentity
         * exists, it will still be sent to the host.
         */
        handleSelection(dataPoint: SelectableDataPoint, multiSelect: boolean): void;

        /** Handles a selection clear, clearing all selection state */
        handleClearSelection(): void;

        /**
         * Sends the selection state to the host
         */
        applySelectionFilter(): void;
    }

    export class InteractivityService implements IInteractivityService, ISelectionHandler {
        private selectionManager: ISelectionManager;

        // References
        private hostService: IVisualHost;
        private renderSelectionInVisual = () => { };
        private renderSelectionInLegend = () => { };
        private renderSelectionInLabels = () => { };

        // Selection state
        private selectedIds: ISelectionId[] = [];
        private isInvertedSelectionMode: boolean = false;
        private hasSelectionOverride: boolean;
        private behavior: any;

        public selectableDataPoints: SelectableDataPoint[];
        public selectableLegendDataPoints: SelectableDataPoint[];
        public selectableLabelsDataPoints: SelectableDataPoint[];

        constructor(hostServices: IVisualHost) {
            this.hostService = hostServices;

            this.selectionManager = hostServices.createSelectionManager();

            if ((this.selectionManager as any).registerOnSelectCallback) {
                (this.selectionManager as any).registerOnSelectCallback(() => {
                    this.restoreSelection([...this.selectionManager.getSelectionIds() as ISelectionId[]]);
                });
            }
        }

        // IInteractivityService Implementation

        /** Binds the visual to the interactivityService */
        public bind(dataPoints: SelectableDataPoint[], behavior: IInteractiveBehavior, behaviorOptions: any, options?: InteractivityServiceOptions): void {
            // Bind the data
            if (options && options.overrideSelectionFromData) {
                // Override selection state from data points if needed
                this.takeSelectionStateFromDataPoints(dataPoints);
            }

            if (options) {
                if (options.isLegend) {
                    // Bind to legend data instead of normal data if isLegend
                    this.selectableLegendDataPoints = dataPoints;
                    this.renderSelectionInLegend = () => behavior.renderSelection(this.legendHasSelection());
                }
                else if (options.isLabels) {
                    // Bind to label data instead of normal data if isLabels
                    this.selectableLabelsDataPoints = dataPoints;
                    this.renderSelectionInLabels = () => behavior.renderSelection(this.labelsHasSelection());
                }
                else {
                    this.selectableDataPoints = dataPoints;
                    this.renderSelectionInVisual = () => behavior.renderSelection(this.hasSelection());
                }

                if (options.hasSelectionOverride != null) {
                    this.hasSelectionOverride = options.hasSelectionOverride;
                }

            }
            else {
                this.selectableDataPoints = dataPoints;
                this.renderSelectionInVisual = () => behavior.renderSelection(this.hasSelection());
            }

            // Bind to the behavior
            this.behavior = behavior;
            behavior.bindEvents(behaviorOptions, this);
            // Sync data points with current selection state
            this.syncSelectionState();
        }

        /**
         * Sets the selected state of all selectable data points to false and invokes the behavior's select command.
         */
        public clearSelection(): void {
            this.hasSelectionOverride = undefined;
            ArrayExtensions.clear(this.selectedIds);
            this.applyToAllSelectableDataPoints((dataPoint: SelectableDataPoint) => dataPoint.selected = false);
            this.renderAll();
        }

        public applySelectionStateToData(dataPoints: SelectableDataPoint[], hasHighlights?: boolean): boolean {
            if (hasHighlights && this.hasSelection()) {
                let selectionIds: ISelectionId[] = (this.selectionManager.getSelectionIds() || []) as ISelectionId[];

                ArrayExtensions.clear(this.selectedIds);
                ArrayExtensions.clear(selectionIds);
            }

            for (let dataPoint of dataPoints) {
                dataPoint.selected = InteractivityService.checkDatapointAgainstSelectedIds(dataPoint, this.selectedIds);
            }

            return this.hasSelection();
        }

        /**
         * Apply new selections to change internal state of interactivity service from filter
         */
        public applySelectionFromFilter(appliedFilter: filter.AppliedFilter): void {
            this.restoreSelection(filter.FilterManager.restoreSelectionIds(appliedFilter));
        }

        /**
         * Apply new selections to change internal state of interactivity service
         */
        public restoreSelection(selectionIds: ISelectionId[]) {
            this.clearSelection();
            this.selectedIds = selectionIds;
            this.syncSelectionState();
            this.renderAll();
        }

        /**
         * Checks whether there is at least one item selected.
         */
        public hasSelection(): boolean {
            return this.selectedIds.length > 0;
        }

        public legendHasSelection(): boolean {
            return this.selectableLegendDataPoints ? dataHasSelection(this.selectableLegendDataPoints) : false;
        }

        public labelsHasSelection(): boolean {
            return this.selectableLabelsDataPoints ? dataHasSelection(this.selectableLabelsDataPoints) : false;
        }

        public isSelectionModeInverted(): boolean {
            return this.isInvertedSelectionMode;
        }

        // ISelectionHandler Implementation

        public applySelectionFilter(): void {
            if (!this.selectionManager) {
                return;
            }

            this.selectionManager.applySelectionFilter();
        }

        public handleSelection(dataPoint: SelectableDataPoint, multiSelect: boolean): void {
            // defect 7067397: should not happen so assert but also don't continue as it's
            // causing a lot of error telemetry in desktop.
            if (!dataPoint) {
                return;
            }

            if (!dataPoint.identity) {
                this.handleClearSelection();
            }
            else {
                this.select(dataPoint, multiSelect);
                this.sendSelectionToHost();
                this.renderAll();
            }
        }

        public handleClearSelection(): void {
            this.clearSelection();
            this.sendSelectionToHost();
        }

        /**
         * Syncs the selection state for all data points that have the same category. Returns
         * true if the selection state was out of sync and corrections were made; false if
         * the data is already in sync with the service.
         *
         * If the data is not compatible with the current service's current selection state,
         * the state is cleared and the cleared selection is sent to the host.
         *
         * Ignores series for now, since we don't support series selection at the moment.
         */
        public syncSelectionState(): void {
            if (this.isInvertedSelectionMode) {
                return this.syncSelectionStateInverted();
            }

            if (!this.selectableDataPoints && !this.selectableLegendDataPoints) {
                return;
            }

            if (this.selectableDataPoints) {
                InteractivityService.updateSelectableDataPointsBySelectedIds(this.selectableDataPoints, this.selectedIds);
            }

            if (this.selectableLegendDataPoints) {
                InteractivityService.updateSelectableDataPointsBySelectedIds(this.selectableLegendDataPoints, this.selectedIds);
            }

            if (this.selectableLabelsDataPoints) {
                for (let labelsDataPoint of this.selectableLabelsDataPoints) {
                    labelsDataPoint.selected = this.selectedIds.some((value: ISelectionId) => {
                        return value.includes(labelsDataPoint.identity as ISelectionId);
                    });
                }
            }
        }

        private syncSelectionStateInverted(): void {
            let selectedIds = this.selectedIds;
            let selectableDataPoints = this.selectableDataPoints;
            if (!selectableDataPoints)
                return;

            if (selectedIds.length === 0) {
                for (let dataPoint of selectableDataPoints) {
                    dataPoint.selected = false;
                }
            }
            else {
                for (let dataPoint of selectableDataPoints) {
                    if (selectedIds.some((value: ISelectionId) => value.includes(dataPoint.identity as ISelectionId))) {
                        dataPoint.selected = true;
                    }
                    else if (dataPoint.selected) {
                        dataPoint.selected = false;
                    }
                }
            }
        }

        // Private utility methods

        private renderAll(): void {
            this.renderSelectionInVisual();
            this.renderSelectionInLegend();
            this.renderSelectionInLabels();
        }

        /** Marks a data point as selected and syncs selection with the host. */
        private select(d: SelectableDataPoint, multiSelect: boolean): void {
            let id = d.identity as ISelectionId;

            if (!id) {
                return;
            }

            let selected = !d.selected || (!multiSelect && this.selectedIds.length > 1);

            // If we have a multiselect flag, we attempt a multiselect
            if (multiSelect) {
                if (selected) {
                    d.selected = true;
                    this.selectedIds.push(id);
                    if (id.hasIdentity()) {
                        this.removeSelectionIdsWithOnlyMeasures();
                    }
                    else {
                        this.removeSelectionIdsExceptOnlyMeasures();
                    }
                }
                else {
                    d.selected = false;
                    this.removeId(id);
                }
            }
            // We do a single select if we didn't do a multiselect or if we find out that the multiselect is invalid.
            if (!multiSelect) {
                this.clearSelection();
                if (selected) {
                    d.selected = true;
                    this.selectedIds.push(id);
                }
            }

            this.syncSelectionState();
        }

        private removeId(toRemove: ISelectionId): void {
            let selectedIds = this.selectedIds;
            for (let i = selectedIds.length - 1; i > -1; i--) {
                let currentId = selectedIds[i];

                if (toRemove.includes(currentId))
                    selectedIds.splice(i, 1);
            }
        }

        private sendSelectionToHost() {
            if (!this.selectionManager) {
                return;
            }

            if (this.selectedIds && this.selectedIds.length) {
                this.selectionManager.select([...this.selectedIds]);
            } else {
                this.selectionManager.clear();
            }
        }

        private takeSelectionStateFromDataPoints(dataPoints: SelectableDataPoint[]): void {
            let selectedIds: ISelectionId[] = this.selectedIds;

            // Replace the existing selectedIds rather than merging.
            ArrayExtensions.clear(selectedIds);

            for (let dataPoint of dataPoints) {
                if (dataPoint.selected) {
                    selectedIds.push(dataPoint.identity as ISelectionId);
                }
            }
        }

        private applyToAllSelectableDataPoints(action: (selectableDataPoint: SelectableDataPoint) => void) {
            let selectableDataPoints = this.selectableDataPoints;
            let selectableLegendDataPoints = this.selectableLegendDataPoints;
            let selectableLabelsDataPoints = this.selectableLabelsDataPoints;
            if (selectableDataPoints) {
                for (let dataPoint of selectableDataPoints) {
                    action(dataPoint);
                }
            }

            if (selectableLegendDataPoints) {
                for (let dataPoint of selectableLegendDataPoints) {
                    action(dataPoint);
                }
            }

            if (selectableLabelsDataPoints) {
                for (let dataPoint of selectableLabelsDataPoints) {
                    action(dataPoint);
                }
            }
        }

        private static updateSelectableDataPointsBySelectedIds(selectableDataPoints: SelectableDataPoint[], selectedIds: ISelectionId[]): boolean {
            let foundMatchingId = false;

            for (let dataPoint of selectableDataPoints) {
                dataPoint.selected = InteractivityService.checkDatapointAgainstSelectedIds(dataPoint, selectedIds);

                if (dataPoint.selected)
                    foundMatchingId = true;
            }

            return foundMatchingId;
        }

        private static checkDatapointAgainstSelectedIds(datapoint: SelectableDataPoint, selectedIds: ISelectionId[]): boolean {
            return selectedIds.some((value: ISelectionId) => value.includes(datapoint.identity as ISelectionId));
        }

        private removeSelectionIdsWithOnlyMeasures() {
            this.selectedIds = this.selectedIds.filter((identity) => identity.hasIdentity());
        }

        private removeSelectionIdsExceptOnlyMeasures() {
            this.selectedIds = this.selectedIds.filter((identity) => !identity.hasIdentity());
        }
    }
}
