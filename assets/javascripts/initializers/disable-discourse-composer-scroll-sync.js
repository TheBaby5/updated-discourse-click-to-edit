import { withPluginApi } from "discourse/lib/plugin-api";

export default {
  name: 'click-to-edit-initializer',
  initialize() {
    withPluginApi("1.0.0", (api) => {
      // Disable the default scroll sync since this plugin handles it better
      api.modifyClass("component:composer-editor", {
        pluginId: "discourse-click-to-edit",
        _syncEditorAndPreviewScroll() {
          // Disabled - click-to-edit plugin handles scroll sync
        }
      });
    });
  }
};