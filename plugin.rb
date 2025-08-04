# frozen_string_literal: true

# name: discourse-click-to-edit
# about: Click in composer preview to go to the markdown source line and vice versa.
# version: 0.11
# authors: Thijs Brilleman
# meta_topic_id: https://meta.discourse.org/t/click-to-edit/321054
# url: https://github.com/thijsbrilleman/discourse-click-to-edit

enabled_site_setting :enable_discourse_click_to_edit

register_asset "vendor/javascripts/markdown-it-line-numbers.js", :vendored_pretty_text

register_asset "stylesheets/discourse-click-to-edit.scss"
