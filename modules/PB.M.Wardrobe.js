/* 
                   _____  _____                          .___            ___.           
    ______  __ ___/ ____\/ ____\_  _  _______ _______  __| _/______  ____\_ |__   ____  
    \____ \|  |  \   __\\   __\\ \/ \/ /\__  \\_  __ \/ __ |\_  __ \/  _ \| __ \_/ __ \ 
    |  |_> >  |  /|  |   |  |   \     /  / __ \|  | \/ /_/ | |  | \(  <_> ) \_\ \  ___/ 
    |   __/|____/ |__|   |__|    \/\_/  (____  /__|  \____ | |__|   \____/|___  /\___  >
    |__|                                     \/           \/                  \/     \/ 
  
  A Puffball module for managing identities and private data locally.
  ==================================================

  The Wardrobe manages identities, aliases, and private data.

  An identity is a username and a list of all known aliases. The identity also lists the last known primary alias, if there is one, and the identity's private preferences. 

  An alias is a username, a 'capa', and a set of private keys. Additional private information (like a passphrase) may be stored in the alias's 'secrets' field.

  Aliases generally correspond either to previous versions of the identity's username (previous primaries), or to anonymous usernames created for one-time encrypted transfer. 

  Username and capa define a unique alias. The capa field references a specific moment in the username's lifecycle, and correlates to the userRecord with the same username and capa whose public keys match the alias's private keys. In other words, capa == version.

  Currently capa counts by consecutive integers. This may change in the future. Any set deriving Eq and Ord will work.

  An identity file can be exported to the local filesystem and imported back in to the system.

  Private data is a black box for 

  Usage examples:
      PB.switchIdentityTo(username)

*/

/*
  THINK:
    - register callback handlers for user record creation and modification
    - PB.M.Wardrobe.init registers those with PB.onUserCreation and PB.onUserModification
    - identity file encryption using a passphrase
*/


PB.M.Wardrobe = {}

~function() { // begin the closure

    var identities = {}
    var aliases = {}
    // {asdf: { username: 'asdf', primary: asdf-12, aliases: [asdf-11, asdf-10], preferences: {} } }

    // an alias: { username: 'asdf', capa: 12, privateRootKey: '123', privateAdminKey: '333', privateDefaultKey: '444', secrets: {} }

    var currentUsername = false


    // TODO: integrate capa with userRecords and puffs everywhere
    // TODO: use capa returned from server on update passphrase
    // TODO: get anon creation working


    PB.M.Wardrobe.init = init
    
    function init() {
        PB.implementSecureInterface(useSecureInfo, addIdentity, addAlias, setPrimaryAlias, setPreference, switchIdentityTo, removeIdentity)
        
        PB.addIdentityUpdateHandler(function() { // THINK: where should this live?
            if(!PB.CONFIG.disableCloudIdentity)
                PB.storeIdentityFileInCloud()
        })
        
        // TODO: find a better way to do this
        var oldConfigValue = PB.CONFIG.disableCloudIdentity
        PB.CONFIG.disableCloudIdentity = true
        
        var storedIdentities = PB.Persist.get('identities') || {}
    
        Object.keys(storedIdentities).forEach(function(username) {
            var identity = storedIdentities[username]
            addIdentity(username, identity.aliases, identity.preferences, true)
        })
        
        PB.CONFIG.disableCloudIdentity = oldConfigValue
        
        var lastUsername = PB.Persist.get('currentUsername')
        
        if (lastUsername)
            PB.switchIdentityTo(lastUsername) // NOTE: call wrapped version to get handlers
    }
    
    
    //// exported via implementSecureInterface

    var useSecureInfo = function(callback) {
        var identity = getCurrentIdentity() || {}
        var primary = identity.primary || {}

        // we have to return all the identities because the user might be trying to list them
        callback(identities, currentUsername, primary.privateRootKey, primary.privateAdminKey, primary.privateDefaultKey)
        
        return true
    }

    var addIdentity = function(username, aliases, preferences, nosave) { // TODO: check if nosave is needed
        // TODO: validation on all available values
        // TODO: check for existing identity
        // TODO: add any unknown aliases
        // THINK: what about aliases that belong to other identities?
        // THINK: ensure primary alias exists?
        // TODO: remove primary (use username+maxcapa instead)

        var identity = { username: username
                       , primary: {}
                       , aliases: []
                       , preferences: preferences || {}
                       }

        identities[username] = identity
        
        if(!Array.isArray(aliases))
            aliases = aliases ? [aliases] : []
        
        aliases.forEach(
            function(alias) {
                addAlias(username, alias.username, alias.capa, alias.privateRootKey, alias.privateAdminKey, alias.privateDefaultKey, alias.secrets)})
        
        // TODO: handle prefs
        
        if(!nosave) // TODO: change processUpdates so it only saves if we're not busy opening all identities? or just let the 100ms throttle handle it...
            processUpdates()
            
        return true
    }

    var addAlias = function(identityUsername, aliasUsername, capa, privateRootKey, privateAdminKey, privateDefaultKey, secrets) {
        // TODO: validation on all available values
        // TODO: check for existing username/capa
        // THINK: hit network for confirmation?
        // THINK: maybe only include viable values?

        var alias = { username: aliasUsername
                    , capa: capa || 1 // NOTE: default capa
                    , privateRootKey: privateRootKey || false
                    , privateAdminKey: privateAdminKey || false
                    , privateDefaultKey: privateDefaultKey || false
                    , secrets: secrets || {}
                    }

        var identity = getIdentity(identityUsername)
        
        if(!identity) {
            addIdentity(identityUsername)                   // creates an empty identity
            identity = getIdentity(identityUsername)
        }
        
        // merge alias
        var old_alias = getOldAlias(identity, alias)
        if(old_alias) {
            alias.secrets = Boron.extend(old_alias.secrets, alias.secrets)
            for(var key in alias) 
                if(alias[key])
                    old_alias[key] = alias[key]
        } else {
            identity.aliases.push(alias)
        }
        
        if(aliasUsername == identityUsername && alias.capa >= (identity.capa||0)) {
            identity.primary = alias                        // set primary for identity (which may have been empty)
        }
        
        aliases[aliasUsername] = identity                   // add this to the alias-identity mapping

        processUpdates()

        return true
    }

    var setPrimaryAlias = function(identityUsername, aliasUsername) {
        var identity = getIdentity(identityUsername)
        
        if(!identity)
            return PB.onError('Primary alias can only be set for known identities')
            
        var alias = getLatestAlias(identity, aliasUsername)
        
        if(!alias)
            return PB.onError('That alias is not associated with that identity')
    
        // all clear!
        
        identity.username = aliasUsername
        identity.primary = alias

        delete identities[identityUsername]
        identities[aliasUsername] = identity
        
        if(identityUsername == currentUsername)
            switchIdentityTo(aliasUsername)
        
        return true
    }
     
    var setPreference = function(key, value) {
        // NOTE: this only works for the current identity
        var identity = getCurrentIdentity()
    
        if(!identity)
            return PB.onError('Preferences can only be set for an active identity')
    
        identity.preferences[key] = value

        processUpdates()
    }
    
    var switchIdentityTo = function(username) {
        if(username) {
            var identity = getIdentity(username)

            if(!identity)
                return PB.onError('No identity found with username "' + username + '"')
        }
        
        currentUsername = username || false

        if(!PB.currentIdentityHash) // THINK: what are the cases?
            PB.currentIdentityHash = PB.Crypto.createMessageHash(JSON.stringify(PB.formatIdentityFile()))
        
        processUpdates()
        
        if(username && identity && identity.primary)
            PB.Users.getUserRecordPromise(username, identity.primary.capa) // fetch our userRecord 

        return true
    }
    
    var removeIdentity = function(username) {
        var identity = getIdentity(username)

        if(!identity)
            return PB.onError('Could not find that identity for removal')

        delete identities[username]

        if(currentUsername == username)
            currentUsername = false

        processUpdates()
    }

    ////
    //// internal helper functions. not exported.
    ////

    function getLatestAlias(identity, aliasUsername) {
        var maxcapa = 0
        var alias = false
        
        for(var i=0, l=identity.aliases.length; i<l; i++) {
            var test = identity.aliases[i]
            if(test.username == aliasUsername && test.capa > maxcapa) {
                alias = test
                maxcapa = test.capa
            }
        }
        
        return alias
    }

    function getOldAlias(identity, alias) {
        for(var i=0, l=identity.aliases.length; i<l; i++) {
            var test = identity.aliases[i]
            if(alias.username == test.username && alias.capa == test.capa)
                return test
        }
    }

    function validatePrivateKeys(username, capa, privateRootKey, privateAdminKey, privateDefaultKey) {
        // CURRENTLY UNUSED
        //// Ensure keys match the userRecord
    
        var prom = PB.Users.getUserRecordPromise(username, capa)
    
        return prom
            .then(function(userRecord) {
                // validate any provided private keys against the userRecord's public keys
                if(   privateRootKey && PB.Crypto.privateToPublic(privateRootKey) != userRecord.rootKey)
                    PB.throwError('That private root key does not match the public root key on record')
                if(  privateAdminKey && PB.Crypto.privateToPublic(privateAdminKey) != userRecord.adminKey)
                    PB.throwError('That private admin key does not match the public admin key on record')
                if(privateDefaultKey && PB.Crypto.privateToPublic(privateDefaultKey) != userRecord.defaultKey)
                    PB.throwError('That private default key does not match the public default key on record')
        
                return userRecord
            }
            , PB.catchError('Could not store private keys due to faulty user record'))
    }

    function processUpdates() {
        if(!PB.CONFIG.ephemeralKeychain)
            PB.Persist.save('identities', identities)

        // THINK: consider zipping identities in localStorage to prevent shoulder-surfing and save space (same for puffs)
        // THINK: consider passphrase protecting identities and private puffs in localStorage
        // TODO: don't persist primary -- regenerate it at load time, so we don't duplicate the alias
        PB.Persist.save('currentUsername', currentUsername)

        PB.runHandlers('identityUpdate')
    }

    function getCurrentIdentity() {
        return getIdentity(currentUsername)
    }

    function getIdentity(username) {
        if(!username) 
            return false

        var identity = identities[username]

        // THINK: we could check the aliases map here in case the username isn't primary

        if(!identity) 
            return false

        return identity
    }

}() // end the closure