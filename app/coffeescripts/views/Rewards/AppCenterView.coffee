define [
  'jst/rewards/AppCenterView'
  'compiled/views/PaginatedCollectionView'
  'compiled/views/Rewards/AppThumbnailView'
], (template, PaginatedCollectionView, AppThumbnailView) ->

  class AppCenterView extends PaginatedCollectionView

    filterText: ''

    template: template
    itemView: AppThumbnailView

    renderItem: (model) =>
      filter = new RegExp(@filterText, "i")
      if model.get('name').match(filter) || model.get('categories').join().match(filter)
        super
