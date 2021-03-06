/* 
                   _____  _____  _____                           
    ______  __ ___/ ____\/ ____\/ ____\___________ __ __  _____  
    \____ \|  |  \   __\\   __\\   __\/  _ \_  __ \  |  \/     \ 
    |  |_> >  |  /|  |   |  |   |  | (  <_> )  | \/  |  /  Y Y  \
    |   __/|____/ |__|   |__|   |__|  \____/|__|  |____/|__|_|  /
    |__|                                                      \/ 
  
  
  A Puffball module for managing forum-style puffs. Wraps the core Puffball API in a fluffy layer of syntactic spun sugar.

  Usage example:
  PB.M.Forum.init()
  ...

*/

PB.M.Forum = {};

PB.M.Forum.contentTypes = {}


/**
 * Bootstrap the forum module
 */
PB.M.Forum.init = function() {
    PB.addRelationshipHandler(PB.M.Forum.addFamilialEdges)              // manages parent-child relationships
    PB.addBeforeSwitchIdentityHandler(PB.M.Forum.clearPuffContentStash)    // clear private caches 
    PB.addPayloadModifierHandler(PB.M.Forum.addTimestamp)               // add timestamp to all new puffs
}


/**
 * Inject a timestamp into the payload
 * the "time" field is optional for puffs, but mandatory for "forum style" puffs
 *
 * @param {Object} payload
 * @returns {Object|{}}
 */
PB.M.Forum.addTimestamp = function(payload) {
    payload = payload || {}
    payload.time = Date.now()
    return payload
}


/**
 * Filter puffs by prop filters
 * @param  {string} filters
 * @return {boolean}
 */
PB.M.Forum.filterByFilters = function(filters) {

    if(!filters) return function() {return true}
    
    //// get a filtering function
    return function(shell) {

        // ROUTES
        if (filters.routes && filters.routes.length > 0) {
            var routeMatch = false;
            for (var i = 0; i < filters.routes.length; i++) {
                if (shell.routes.indexOf(filters.routes[i]) > -1) routeMatch = true;
            }
            if (!routeMatch) return false;
        }

        // TAGS
        if (filters.tags && filters.tags.length > 0) {
            if (!shell.payload.tags || !shell.payload.tags.length) {
                return false;
            }
            var tagMatch = false;
            for (var i = 0; i < filters.tags.length; i++) {
                if (shell.payload.tags.indexOf(filters.tags[i]) > -1) tagMatch = true;
            }
            if (!tagMatch) return false;
        }

        // TYPES
        if (filters.types && filters.types.length > 0) {
            if (!~filters.types.indexOf(shell.payload.type)) {
                // console.log(shell.type)
                return false
            }
        }

        // USERS
        if(filters.users && filters.users.length > 0)
            if(!~filters.users.indexOf(PB.Users.justUsername(shell.username))) return false


        if(filters.roots)
            if((shell.payload.parents||[]).length) return false

        if(filters.ancestors && filters.focus) {
            var focus = PB.getPuffBySig(filters.focus) // TODO: find better way to do this
            if(focus.payload && !~focus.payload.parents.indexOf(shell.sig)) return false
        }

        if(filters.descendants && filters.focus)
            if(!~shell.payload.parents.indexOf(filters.focus)) return false

        // TODO: deprecate this, as it's handled above:
        if (filters.type && filters.type.length)
            if (!~filters.type.indexOf(shell.payload.type)) return false

        return true
    }
}



/**
 * Helper for sorting by payload.time
 * @param  {Object} a
 * @param  {object} b
 * @return {number} based on desired sorting order
 */
PB.M.Forum.sortByPayload = function(a,b) {
    //// helper for sorting by payload.time
    if(puffworldprops.view.query.sort == 'DESC')
        return b.payload.time - a.payload.time;
    else
        return a.payload.time - b.payload.time;
}



/**
 * Get the current puff's parents
 * @param  {Object} puff
 * @param  {Object} props
 * @return {number} The number of parents
 */
PB.M.Forum.getParentCount = function(puff, props) {
    if(!puff) return 0
    
    var sig = puff.sig || puff
    
    return PB.Data.graph.v(sig).out('parent').run().length
}


/**
 * Get a count of the current puff's children
 * @param  {Object} puff
 * @return {number} The number of children
 */
PB.M.Forum.getChildCount = function(puff) {
    if(!puff) return 0
    
    var sig = puff.sig || puff
    
    return PB.Data.graph.v(sig).out('child').run().length
}


/**
 * Filter puffs according to criteria
 * @param  {string} query
 * @param  {string} filters
 * @param  {number} limit
 * @return {array} An array of puffs
 */
PB.M.Forum.getPuffList = function(query, filters, limit) {
    //// returns a list of puffs

    // THINK: the graph can help us here, but only if we're more clever about forming relationships and using those in our filters.

    limit = limit || Infinity
    var offset = +query.offset||0

    // var shells = PB.M.Forum.getShells(query, filters)
    var shells = PB.Data.getAllMyShells()
    
    var filtered_shells = shells.filter(PB.M.Forum.filterByFilters(Boron.extend({}, query, filters)))
                                .sort(PB.M.Forum.sortByPayload) // TODO: sort by query

    var sliced_shells = filtered_shells.slice(offset, offset+limit)
    
    var puffs = sliced_shells.map(PB.Data.getPuffFromShell)
                             .filter(Boolean)

    var have = sliced_shells.length
    // var have = puffs.length
    if(have >= limit)
        return puffs  // as long as we have enough filtered shells the puffs will eventually fill in empty spots

    PB.Data.fillSomeSlotsPlease(limit, have, query, filters)
    
    return puffs;
}


/**
 * Takes a string of content, create a puff and push it into the system
 * @param {string} type
 * @param {string} content
 * @param {array} parents
 * @param {Object} metadata
 * @param {string[]} userRecordsForWhomToEncrypt
 * @param {string[]} privateEnvelopeAlias
 * @returns {promise}
 */
PB.M.Forum.addPost = function(type, content, parents, metadata, userRecordsForWhomToEncrypt, privateEnvelopeAlias) {
    //// Given a string of content, create a puff and push it into the system
    
    // ensure parents is an array
    if(!parents) parents = []
    if(!Array.isArray(parents)) parents = [parents]
    
    // ensure parents contains only puff ids
    if(parents.map(PB.getPuffBySig).filter(function(x) { return x != null }).length != parents.length)
        return PB.emptyPromise('Those are not good parents')
    
    // ensure parents are unique
    parents = PB.uniquify(parents)

    // find the routes using parents
    var routes = parents.map(function(id) {
        return PB.getPuffBySig(id).username
    });
    if (metadata.routes) {
        routes = metadata.routes // THINK: this should probably merge with above instead of replacing it...
        delete metadata['routes']
    }
    
    // ensure all routes are unique
    routes = PB.uniquify(routes)
    
    var takeUserMakePuff = PB.M.Forum.partiallyApplyPuffMaker(type, content, parents, metadata, routes, userRecordsForWhomToEncrypt, privateEnvelopeAlias)
    
    // get a user promise
    var userprom = PB.Users.getUpToDateUserAtAnyCost()
    
    var prom = userprom.catch(PB.catchError('Failed to add post: could not access or create a valid user'))
                       .then(takeUserMakePuff)
                       .catch(PB.catchError('Posting failed'))
    
    return prom
    
    // NOTE: any puff that has 'time' and 'parents' fields fulfills the forum interface
    // TODO: make an official interface fulfillment thing
}


/**
 * Make a puff... except the parts that require a user
 * @param {string} type
 * @param {string} content
 * @param {array} parents
 * @param {object} metadata
 * @param {array} routes
 * @param {array} userRecordsForWhomToEncrypt
 * @param {array} privateEnvelopeAlias
 * @returns {Function}
 */
PB.M.Forum.partiallyApplyPuffMaker = function(type, content, parents, metadata, routes, userRecordsForWhomToEncrypt, privateEnvelopeAlias) {
    //// Make a puff... except the parts that require a user
    
    // THINK: if you use the same metadata object for multiple puffs your cached version of the older puffs will get messed up
    
    var payload = metadata || {}                            // metadata becomes the basis of payload
    payload.parents = payload.parents || parents            // ids of the parent puffs
    payload.time = metadata.time || Date.now()              // time is always a unix timestamp
    payload.tags = metadata.tags || []                      // an array of tags // TODO: make these work

    var type  = type || 'text'
    var routes = routes ? routes : [];
    routes = routes.concat(PB.CONFIG.zone);
    
    return function(userRecord) {
        // userRecord is always an up-to-date record from the DHT, so we can use its 'latest' value here 

        var previous = userRecord.latest
        var puff = PB.simpleBuildPuff(type, content, payload, routes, userRecordsForWhomToEncrypt, privateEnvelopeAlias)

        return PB.addPuffToSystem(puff) // THINK: this fails silently if the sig exists already
    }
}

/// graph relationships ///

PB.M.Forum.addFamilialEdges = function(shells) {
    shells.forEach(PB.M.Forum.addFamilialEdgesForShell)
}

PB.M.Forum.addFamilialEdgesForShell = function(child) {
    var addParentEdges = PB.M.Forum.addFamilialEdgesForParent(child);
    (child.payload.parents||[]).forEach(addParentEdges);
}

PB.M.Forum.addFamilialEdgesForParent = function(child) {
    var existingParents = PB.Data.graph.v(child.sig).out('parent').property('shell').run().map(PB.prop('sig'))
    
    return function(parentSig) {
        if(~existingParents.indexOf(parentSig)) return false                       // done?
        PB.Data.addSigAsVertex(parentSig)                                          // idempotent
        PB.Data.graph.addEdge({_label: 'parent', _in: parentSig, _out: child.sig}) // not idempotent
        PB.Data.graph.addEdge({_label: 'child', _out: parentSig,  _in: child.sig})
    }
}

/// end graph relationships ///


/**
 * to process the content
 * @param  {string} type
 * @param  {string} content
 * @param  {puff} puff
 * @return {string}
 */
PB.M.Forum.processContent = function(type, content, puff) {
    var typeObj = PB.M.Forum.contentTypes[type]
    
    if(!typeObj)
        typeObj = PB.M.Forum.contentTypes['text']

    return typeObj.toHtml(content, puff)
}


// TODO: this might get big, need some GC here
PB.M.Forum.puffContentStash = {}

PB.M.Forum.clearPuffContentStash = function() {
    PB.M.Forum.puffContentStash = {}
}

/**
 * Get the content of a puff
 * @param  {puff} puff
 * @return {string}
 */
PB.M.Forum.getProcessedPuffContent = function(puff) {
    // THINK: we've already ensured these are proper puffs, so we don't have to check for payload... right?
    if(PB.M.Forum.puffContentStash[puff.sig])
        return PB.M.Forum.puffContentStash[puff.sig]
    
    var content = PB.M.Forum.processContent(puff.payload.type, puff.payload.content, puff)
    PB.M.Forum.puffContentStash[puff.sig] = content
    
    return content
}

/**
 * Add support for types of content to the system
 * @param {string} name
 * @param {string} type
 */
PB.M.Forum.addContentType = function(name, type) {
    // THINK: move this down into PB?
    
    if(!name) 
        return PB.onError('Invalid content type name')
    if(PB.CONFIG.supportedContentTypes && PB.CONFIG.supportedContentTypes.indexOf(name) == -1)
        return PB.onError('Unsupported content type: ' + name)
    if(!type.toHtml) 
        return PB.onError('Invalid content type: object is missing toHtml method', name)
    
    PB.M.Forum.contentTypes[name] = type
}


// DEFAULT CONTENT TYPES

PB.M.Forum.addContentType('text', {
    toHtml: function(content) {
        var safe_content = XBBCODE.process({ text: content })   // not ideal, but it does seem to strip out raw html
        safe_content.html = safe_content.html.replace(/\n/g, '</br>');  // Set line breaks
        return '<span>' + safe_content.html + '</span>'
    }
})

PB.M.Forum.addContentType('bbcode', {
    toHtml: function(content) {
        var bbcodeParse = XBBCODE.process({ text: content });
        var parsedText  = bbcodeParse.html.replace(/\n/g, '<br />'); 
        return parsedText;
    }
})

PB.M.Forum.addContentType('image', {
    toHtml: function(content) {
        if(puffworldprops.view.mode == "tableView")
            return '<img src=' + content + ' />';
        else
            return '<img class="imgInBox" src=' + content + ' />';
    }
})

PB.M.Forum.addContentType('markdown', {
    toHtml: function(content) {
        var converter = new Markdown.Converter();
        return '<span>'+converter.makeHtml(content)+'</span>';
    }
})

// Used to display chess boards
PB.M.Forum.addContentType('PGN', {
    toHtml: function(content) {
        return chessBoard(content);
    }
})

PB.M.Forum.addContentType('identity', {
    toHtml: function() {
        return ''
    }
})

PB.M.Forum.addContentType('profile', {
    toHtml: function(content, puff) {
        if(puffworldprops.view.mode == "tableView")
            return '<img src=' + content + ' />';
        else
            return '<img class="imgInBox" src=' + content + ' />';
        /*var keysNotShow = ['content', 'type'];
        for (var key in puff.payload) {
            var value = puff.payload[key];
            if (keysNotShow.indexOf(key)==-1 && value && value.length) {
                toRet += '<div><span class="profileKey">' + key + ': </span><span class="profileValue">' + value + '</span></div>';
            }
        }*/
    }
})

PB.M.Forum.addContentType('file', {
    toHtml: function(content, puff) {
        return (
            puff.payload.filename
            )
    }

})

// TODO: Add support for LaTex
/*PB.M.Forum.addContentType('LaTex', {
    toHtml: function(content) {
        var safe_content = XBBCODE.process({ text: content }) 
        return '<p>' + safe_content.html + '</p>'
    }
}) */


// Flag a puff
PB.M.Forum.flagPuff = function (sig) {

    var payload = {};
    var routes = [];
    var type = 'flagPuff';
    var content = sig;
    
    payload.time = Date.now();

    PB.useSecureInfo(function(identities, currentUsername, privateRootKey, privateAdminKey, privateDefaultKey) {    

        if(!currentUsername) {
            alert("You must first set your username before you can flag content");
            return false;
        }
        /*if(!currentUsername == PB.getPuffBySig(sig).username) {
            alert("You must set your identity to the author of the puff you want to flag");
        }*/
        if(!privateAdminKey) {
            alert("You must first set your private admin key before you can flag content");
            return false;
        }
    
        var puff = PB.buildPuff(currentUsername, privateAdminKey, routes, type, content, payload);
    })

    var data = { type: 'flagPuff'
               , puff: puff
               };

    var prom = PB.Net.PBpost(PB.CONFIG.puffApi, data);
    
    prom = prom.then(function(result){
        // var storedShells = PB.Persist.get('shells');
        // var filteredShells = storedShells.filter(function(s){return s.sig != content && s.content != content});
        var flaggedSig = PB.Persist.get('flagged') || [];
        flaggedSig.push(content);

        // PB.Persist.save('shells', filteredShells);
        PB.Persist.save('flagged', flaggedSig);
        // reload?
        // document.location.reload();
        Events.pub('ui/flag', {});
        return result;
    })
    return prom;
}


// Adding default metafields to included in a puff
PB.M.Forum.metaFields = []
PB.M.Forum.context = {};
PB.M.Forum.addMetaFields = function(fieldInfo, context, excludeContext) {
    // NOTE: this isn't used outside of publishEmbed.js, but it might provide a good basis for generic/required metadata
    
    if (!fieldInfo.name) return console.log('Invalid meta field name.');

    // supported type: text, textarea, pulldown, array
    if (!fieldInfo.type) return console.log('Invalid meta field type.');

    if (!fieldInfo.validator || typeof fieldInfo.validator != 'function') {
        fieldInfo.validator = false;
    }

    context = context || Object.keys(PB.M.Forum.contentTypes);
    if (typeof context == 'string') {
        context = [context];
    } else if (!Array.isArray(context)) {
        return PB.onError('Invalid context.')
    }

    excludeContext = excludeContext || [];
    if (typeof excludeContext == 'string') {
        excludeContext = [excludeContext];
    }else if (!Array.isArray(excludeContext)) {
        return PB.onError('Invalid context.')
    }

    PB.M.Forum.metaFields.push(fieldInfo);
    for (var i=0; i<context.length; i++) {
        if (excludeContext.indexOf(context[i]) != -1)
            continue;
        var contextFields = PB.M.Forum.context[context[i]] || [];
        contextFields.push(fieldInfo.name);
        PB.M.Forum.context[context[i]] = contextFields;
    }
}

PB.M.Forum.addMetaFields(
    {name: 'reply privacy',
     type: 'pulldown',
     enum: ['', 'public', 'private', 'anonymous', 'invisible'],
     defaultValue: ''});

PB.M.Forum.addMetaFields(
    {name: 'content license',
     type: 'pulldown',
     enum: ['', 'CreativeCommonsAttribution', 'GNUPublicLicense', 'Publicdomain', 'Rights-managed', 'Royalty-free'],
     defaultValue: ''});

PB.M.Forum.addMetaFields(
    {name: 'tags',
     type: 'array',
     validator: function(v){return /^[a-z0-9]+$/i.test(v)}
     },
    false, 'profile');

PB.M.Forum.addMetaFields(
    {name: 'language',
     type: 'text',
     defaultValue: function(){return puffworldprops.view.language}});

PB.M.Forum.addMetaFields(
    {name: 'name',
     type: 'text'},
    'profile');