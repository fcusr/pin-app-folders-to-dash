const {Clutter, Gio, Shell, St} = imports.gi;
const AppDisplay = imports.ui.appDisplay;
const AppFavorites = imports.ui.appFavorites;
const BoxPointer = imports.ui.boxpointer;
const Dash = imports.ui.dash;
const Main = imports.ui.main;
const PopupMenu = imports.ui.popupMenu;

let originalEnsurePlaceholder;
function ensurePlaceholder(source) {
    if(source instanceof AppDisplay.AppIcon) {
        originalEnsurePlaceholder.call(this, source);
        return;
    }
    if(this._placeholder) {
        return;
    }
    let id = source.id;
    let path = `${this._folderSettings.path}folders/${id}/`;
    this._placeholder = new AppDisplay.FolderIcon(id, path, this);
    this._placeholder.connect('notify::pressed', icon => {
        if(icon.pressed) {
            this.updateDragFocus(icon);
        }
    });
    this._placeholder.scaleAndFade();
    this._redisplay();
}

let originalLoadApps;
function loadApps() {
    let appIcons = originalLoadApps.call(this);
    let appFavorites = AppFavorites.getAppFavorites();
    let filteredFolderIcons = this._folderIcons.filter
    (icon => !appFavorites.isFavorite(icon._id));
    this._folderIcons.forEach(icon => {
        if(appFavorites.isFavorite(icon._id)) {
            appIcons.splice(appIcons.indexOf(icon), 1);
            icon.destroy();
        }
    });
    this._folderIcons = filteredFolderIcons;
    return appIcons;
}

let originalInitFolderIcon;
function initFolderIcon(id, path, parentView) {
    originalInitFolderIcon.call(this, id, path, parentView);
    this.app = lookupAppFolder(id);
    this.connect('button-press-event', (actor, event) => {
        if(event.get_button() == 3) {
            popupMenu.call(this);
            return Clutter.EVENT_STOP;
        }
    });
    this._menuManager = new PopupMenu.PopupMenuManager(this);
}

function popupMenu() {
    this.setForcedHighlight(true);
    this.fake_release();
    if(!this._menu) {
        let appFavorites = AppFavorites.getAppFavorites();
        let isFavorite = appFavorites.isFavorite(this._id);
        let side = isFavorite ? St.Side.BOTTOM : St.Side.LEFT;
        let label = isFavorite ? _('Unpin') : _('Pin to Dash');
        this._menu = new PopupMenu.PopupMenu(this, 0.5, side);
        this._menu.addAction(label, () => {
            if(isFavorite) {
                appFavorites.removeFavorite(this._id);
            } else {
                appFavorites.addFavorite(this._id);
            }
        });
        this._menu.connect('open-state-changed', (menu, isPoppedUp) => {
            if(!isPoppedUp) {
                this.setForcedHighlight(false);
            }
        });
        Main.overview.connectObject('hiding', () => {
            this._menu.close();
        }, this);
        Main.uiGroup.add_actor(this._menu.actor);
        this._menuManager.addMenu(this._menu);
    }
    this._menu.open(BoxPointer.PopupAnimation.FULL);
    this._menuManager.ignoreRelease();
    let item = this.get_parent();
    if(item instanceof Dash.DashItemContainer) {
        let controls = Main.overview._overview._controls;
        controls.dash._syncLabel(item, this);
    }
}

let originalUpdateName;
function updateName() {
    let item = this.get_parent();
    if(item instanceof Dash.DashItemContainer) {
        this._name = AppDisplay._getFolderName(this._folder);
        item.setLabelText(this._name);
    } else {
        originalUpdateName.call(this);
    }
}

let originalReload;
function reload() {
    originalReload.call(this);
    let appDisplay = Main.overview._overview._controls._appDisplay;
    let folders = appDisplay._folderSettings.get_strv('folder-children');
    let ids = global.settings.get_strv(this.FAVORITE_APPS_KEY);
    this._favorites = {};
    ids.forEach(id => {
        let app = Shell.AppSystem.get_default().lookup_app(id);
        if(app != null
        && this._parentalControlsManager.shouldShowApp(app.app_info)) {
            this._favorites[app.get_id()] = app;
        } else if(folders.includes(id)) {
            this._favorites[id] = lookupAppFolder(id);
        }
    });
}

let originalAddFavorite;
function addFavorite(appId, pos) {
    let appDisplay = Main.overview._overview._controls._appDisplay;
    let folders = appDisplay._folderSettings.get_strv('folder-children');
    if(!folders.includes(appId)) {
        return originalAddFavorite.call(this, appId, pos);
    }
    if(appId in this._favorites) {
        return false;
    }
    let ids = this._getIds();
    ids.splice(pos == -1 ? ids.length : pos, 0, appId);
    global.settings.set_strv(this.FAVORITE_APPS_KEY, ids);
    return true;
}

let originalAddFavoriteAtPos;
function addFavoriteAtPos(appId, pos) {
    let appDisplay = Main.overview._overview._controls._appDisplay;
    let folders = appDisplay._folderSettings.get_strv('folder-children');
    if(!folders.includes(appId)) {
        originalAddFavoriteAtPos.call(this, appId, pos);
    }
    if(!this._addFavorite(appId, pos)) {
        return;
    }
    let path = `${appDisplay._folderSettings.path}folders/${appId}/`;
    let folder = new Gio.Settings({
        schema_id: 'org.gnome.desktop.app-folders.folder',
        path,
    });
    let folderName = AppDisplay._getFolderName(folder);
    let msg = _('%s has been pinned to the dash.').format(folderName);
    Main.overview.setMessage(msg, {
        forFeedback: true,
        undoCallback: () => this._removeFavorite(appId),
    });
}

let originalRemoveFavorite;
function removeFavorite(appId) {
    let appDisplay = Main.overview._overview._controls._appDisplay;
    let folders = appDisplay._folderSettings.get_strv('folder-children');
    if(!folders.includes(appId)) {
        originalRemoveFavorite.call(this, appId);
    }
    let pos = this._getIds().indexOf(appId);
    if (!this._removeFavorite(appId)) {
        return;
    }
    let path = `${appDisplay._folderSettings.path}folders/${appId}/`;
    let folder = new Gio.Settings({
        schema_id: 'org.gnome.desktop.app-folders.folder',
        path,
    });
    let folderName = AppDisplay._getFolderName(folder);
    let msg = _('%s has been unpinned from the dash.').format(folderName);
    Main.overview.setMessage(msg, {
        forFeedback: true,
        undoCallback: () => this._addFavorite(appId, pos),
    });
}

let originalGetAppFromSource;
function getAppFromSource(source) {
    if(source instanceof AppDisplay.FolderIcon) {
        return source.app;
    }
    return originalGetAppFromSource(source);
}

let originalCreateAppItem;
function createAppItem(app) {
    if(app instanceof Shell.App) {
        return originalCreateAppItem.call(this, app);
    }
    let appDisplay = Main.overview._overview._controls._appDisplay;
    let id = app.toString();
    let path = `${appDisplay._folderSettings.path}folders/${id}/`;
    let appIcon = new AppDisplay.FolderIcon(id, path, appDisplay);
    appIcon.connect('apps-changed', () => {
        appDisplay._redisplay();
        appDisplay._savePages();
        appIcon.view._redisplay();
    });
    let item = new Dash.DashItemContainer();
    item.setChild(appIcon);
    appIcon.icon.style_class = 'overview-icon';
    appIcon.icon._box.remove_actor(appIcon.icon.label);
    appIcon.label_actor = appIcon.icon.label = null;
    item.setLabelText(AppDisplay._getFolderName(appIcon._folder));
    appIcon.icon.setIconSize(this.iconSize);
    appIcon.icon.y_align = Clutter.ActorAlign.CENTER;
    appIcon.shouldShowTooltip = () =>
    appIcon.hover && (!appIcon._menu || !appIcon._menu.isOpen);
    this._hookUpLabel(item);
    return item;
}

let appFolders = {};
function lookupAppFolder(id) {
    if(!appFolders[id]) {
        appFolders[id] = new String(id);
        appFolders[id].is_window_backed = () => false;
        appFolders[id].get_id = () => id;
    }
    return appFolders[id];
}

function redisplayIcons() {
    AppFavorites.getAppFavorites().reload();
    let controls = Main.overview._overview._controls;
    let apps = controls._appDisplay._orderedItems.slice();
    apps.forEach(icon => {
        controls._appDisplay._removeItem(icon);
    });
    controls._appDisplay._redisplay();
    controls.dash._queueRedisplay();
}

function enable() {
    let appDisplay = AppDisplay.AppDisplay;
    originalEnsurePlaceholder = appDisplay.prototype._ensurePlaceholder;
    appDisplay.prototype._ensurePlaceholder = ensurePlaceholder;
    originalLoadApps = appDisplay.prototype._loadApps;
    appDisplay.prototype._loadApps = loadApps;
    originalInitFolderIcon = AppDisplay.FolderIcon.prototype._init;
    AppDisplay.FolderIcon.prototype._init = initFolderIcon;
    originalUpdateName = AppDisplay.FolderIcon.prototype._updateName;
    AppDisplay.FolderIcon.prototype._updateName = updateName;
    let appFavorites = AppFavorites.getAppFavorites().constructor;
    originalAddFavorite = appFavorites.prototype._addFavorite;
    appFavorites.prototype._addFavorite = addFavorite;
    originalAddFavoriteAtPos = appFavorites.prototype.addFavoriteAtPos;
    appFavorites.prototype.addFavoriteAtPos = addFavoriteAtPos;
    originalRemoveFavorite = appFavorites.prototype.removeFavorite;
    appFavorites.prototype.removeFavorite = removeFavorite;
    originalReload = appFavorites.prototype.reload;
    appFavorites.prototype.reload = reload;
    originalGetAppFromSource = Dash.getAppFromSource;
    Dash.getAppFromSource = getAppFromSource;
    originalCreateAppItem = Dash.Dash.prototype._createAppItem;
    Dash.Dash.prototype._createAppItem = createAppItem;
    redisplayIcons();
}

function disable() {
    let appDisplay = AppDisplay.AppDisplay;
    appDisplay.prototype._ensurePlaceholder = originalEnsurePlaceholder;
    appDisplay.prototype._loadApps = originalLoadApps;
    AppDisplay.FolderIcon.prototype._init = originalInitFolderIcon;
    AppDisplay.FolderIcon.prototype._updateName = originalUpdateName;
    let appFavorites = AppFavorites.getAppFavorites().constructor;
    appFavorites.prototype._addFavorite = originalAddFavorite;
    appFavorites.prototype.addFavoriteAtPos = originalAddFavoriteAtPos;
    appFavorites.prototype.removeFavorite = originalRemoveFavorite;
    appFavorites.prototype.reload = originalReload;
    Dash.getAppFromSource = originalGetAppFromSource;
    Dash.Dash.prototype._createAppItem = originalCreateAppItem;
    redisplayIcons();
}
