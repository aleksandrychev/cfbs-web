const got = require("got");
const {extname} = require("path");
const {createHash} = require("crypto");
const CONTENT_PATH_PREFIX = "./content/modules";
module.exports = function (grunt) {
    require('jit-grunt')(grunt);
    grunt.initConfig({
        less: {
            development: {
                options: {
                    compress: true,
                    yuicompress: true,
                    optimization: 2
                },
                files: {
                    "./themes/cfbs-theme/static/css/style.min.css": "./themes/cfbs-theme/styles/cfbs.less"
                }
            }
        },
        uglify: {
            options: {
                sourceMap: false
            },
            build: {
                files: {
                    './static/js/bundles/main.js': ['./static/js/main.js'],
                    './static/js/bundles/modules-page.js': ['./node_modules/lunr/lunr.js', './static/js/modules-list.js'],
                }
            }
        },
    });

    grunt.registerTask("lunr-index", function () {
        let indexPages = function () {
            let pagesIndex = [];
            grunt.file.recurse(CONTENT_PATH_PREFIX, function (abspath, rootdir, subdir, filename) {
                grunt.verbose.writeln("Parse file:", abspath);
                const index = processFile(abspath, filename);
                if (index !== null) {
                    pagesIndex.push(index);
                }
                return;
            });
            return pagesIndex;
        };

        let processFile = function (abspath, filename) {
            let content = grunt.file.read(abspath);
            if (!content.includes('commit')) {
                return null
            }
            let pageIndex;
            // parse JSON fronmatter from the content
            const m = content.match(/^{([\s\S]*?)^}/m);

            let frontMatter;
            try {
                frontMatter = JSON.parse(m[0]);
            } catch (e) {
                console.error(e.message);
            }

            // exclude hidden pages
            if (frontMatter.hide == true) {
                return null;
            }

            const match = abspath.match(/^content(\/modules\/.*\/)/);
            let href = match[1];

            // Build Lunr index for this page
            pageIndex = {
                ...frontMatter,
                href: href
            };

            return pageIndex;
        };
        grunt.file.write("./static/js/lunr/PagesIndex.json", JSON.stringify(indexPages()));
        grunt.log.ok("Index built");
    });

    const got = require('got')
    const {extname} = require('path')
    const {createHash} = require('crypto')
    grunt.registerTask("modules-update", async function () {
        const done = this.async();
        if (!process.env.hasOwnProperty('GITHUB_USERNAME_TOKEN')) {
            grunt.log.error('GITHUB_USERNAME_TOKEN env variable is not set. Format is: username@token')
            return;
        }
        const headers = {
            "Authorization": "Basic " + Buffer.from(process.env.GITHUB_USERNAME_TOKEN).toString("base64")
        };
        const response = await got('https://raw.githubusercontent.com/cfengine/build-index/master/cfbs.json', {headers}).json();
        const versions = await got('https://raw.githubusercontent.com/cfengine/build-index/master/versions.json', {headers}).json();
        const limit = await got('https://api.github.com/rate_limit', {headers}).json();
        const downloadStat = await got('https://archive.build.cfengine.com/stats').json();
        console.log(`Remaining limit: ${limit.resources.core.remaining}`)

        const modules = response.index;
        let authors = grunt.file.readJSON('./static/js/authors.json');
        let authorsChanged = false;


        let i = 0;
        for (const index in modules) {
            i++;
            const module = modules[index];

            if (!module.hasOwnProperty('alias')) {

                const authorRepo = module.repo.replace(/^(https\:\/\/github\.com\/)/, "").toString();
                const repoInfo = await got('https://api.github.com/repos/' + authorRepo, {headers}).json();
                const revision = module.commit || 'master';

                // author
                const owner = module.by.replace(/^(https\:\/\/github\.com\/)/, "").replace(/\/$/, "").toString();

                if (!authors.hasOwnProperty(owner)) { // if no author -> write
                    const authorResponse = await got('https://api.github.com/users/' + owner, {headers}).json();
                    authors[owner] = authorResponse;
                    authorsChanged = true;
                }
                // author end

                // content
                let content, extension = '.html', version = {};

                if (versions[index] && (version = versions[index][module.version]) && version.readme_url != null) {
                    ({content, extension} = await getContent(version.readme_url, version.readme_sha256));
                } else  {
                    content = 'Readme not found'
                }

                // frontmatters
                let frontmatter = {
                    "title": index,
                    "date": repoInfo.updated_at,
                    "id": index,
                    "description": module.description || '',
                    "author": {
                        "image": authors[owner].avatar_url,
                        "name": authors[owner].name,
                        "url": module.by
                    },
                    "versions": {},
                    "updated": getFormattedDate(new Date(repoInfo.updated_at)),
                    "downloads": downloadStat[index] ?? 0,
                    "repo": module.repo,
                    "documentation": module.documentation || null,
                    "website": module.website || null,
                    "subdirectory": module.subdirectory,
                    "commit": module.commit,
                    "dependencies": module.dependencies || [],
                    "tags": module.tags || [],
                    "layout": "single"
                }

                if (module.hasOwnProperty('version')) {
                    frontmatter.version = module.version;
                    const moduleVersions = versions[index];
                    frontmatter.versions = Object.keys(moduleVersions).reduce((reducer, version) => {
                        reducer[version] = {date: getFormattedDate(new Date(moduleVersions[version].timestamp)), latest: version == module.version};
                        return reducer;
                    }, {});

                    (await processVersions(module.version, moduleVersions, frontmatter)).forEach(item => {
                        grunt.file.write(`./content/modules/${index}/${item.version}${extension}`, `${JSON.stringify(item.frontmatter, null, 2)}\n${item.content}`);
                    });
                }
                // frontmatters end
                grunt.file.write(`./content/modules/${index}/_index${extension}`, `${JSON.stringify(frontmatter, null, 2)}\n${content}`);

                grunt.log.ok(`${index} page created`);
            }
        }
        if (authorsChanged) {
            grunt.file.write('./static/js/authors.json', JSON.stringify(authors, null, 2));
        }
        done();
    });

    const processVersions = async function (current, versions, frontmatter) {
        let result = [];
        for (const version in versions) {
            let copiedFM = Object.assign({}, frontmatter);
            if (current === version) continue;
            copiedFM.hide = true;
            copiedFM.id += `@${version}`
            copiedFM.version = version;
            let content = 'Readme not found', extension = '.html';
            if (versions[version].readme_url != null) {
                ({content, extension} = await getContent(versions[version].readme_url, versions[version].readme_sha256));
            }

            result.push({content, extension, frontmatter: copiedFM, version});
        }
        return result;
    }

    const getContent = async function (readmeUrl, readmeSHA256) {
       let  content = await got(`https://cfbs.s3.amazonaws.com/${readmeUrl}`).text();
       const extension = extname(readmeUrl);

        const checksum = createHash('sha256').update(content).digest('hex');

        if (checksum !== readmeSHA256) {
            console.error(`${readmeUrl} checksum is wrong`);
            process.exit(1);
        }

        return {content, extension}
    }

    const getFormattedDate = date => date.toLocaleDateString('en-us', {year: "numeric", month: "short", day: "numeric"});

    grunt.registerTask('build', ['modules-update', 'lunr-index', 'uglify', 'less']);
};
