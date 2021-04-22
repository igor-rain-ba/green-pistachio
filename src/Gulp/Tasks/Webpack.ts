import { TaskFunction, watch } from "gulp";
import debug from 'debug';
import WebpackDevServer from 'webpack-dev-server';
import { certificateFor } from 'devcert';
import Project from "../../Models/Project";
import Theme from "../../Models/Theme";
import WebpackConfigFactory from "../../Webpack/ConfigFactory";
import GetCompiler from "../../Webpack/GetCompiler";
import { TaskInterface } from "./TaskInterface";
import TsConfigBuilder from "../../Models/Project/TsConfigBuilder";
import { responseInterceptor } from "../../Webpack/DevServerResponseInterceptor";
const logger = debug('gpc:gulp:webpack');

export default class Webpack implements TaskInterface {
    private webpackConfigFactory: WebpackConfigFactory;
    private getCompiler: GetCompiler;
    private tsConfigBuilder: TsConfigBuilder;
    private configFileExists: boolean = false;

    constructor() {
        this.webpackConfigFactory = new WebpackConfigFactory();
        this.getCompiler = new GetCompiler();
        this.tsConfigBuilder = new TsConfigBuilder();
    }

    execute(project: Project, theme?: Theme): TaskFunction {
        const webpackTask: TaskFunction = async (done) => {
            if (!this.configFileExists) {
                const exists = await this.tsConfigBuilder.configFileExists();
                
                if (!exists) {
                    await this.tsConfigBuilder.emitConfigFile(project);
                }

                this.configFileExists = true;
            }

            const config = await this.webpackConfigFactory.getConfig(project, theme);
            const compiler = this.getCompiler.execute(config);

            compiler.run((err, stats) => {
                if (err) {
                    logger(err);
                }

                if (stats) {
                    logger(stats.toString({
                        colors: true
                    }));
                }

                done();
            });
        };

        webpackTask.displayName = 'webpack';

        return webpackTask;
    }

    watch(project: Project, theme?: Theme): TaskFunction {
        return async (done) => {
            project.setWebpackDevelopmentMode();
            const config = await this.webpackConfigFactory.getConfig(project, theme);
            const compiler = this.getCompiler.execute(config);

            let ssl = await certificateFor('green-pistachio.test');

            // Store magento cookies and append back with each proxy request
            let cookieData: string[] | null;

            const proxyUrl = project.getProxyUrl();

            // @ts-ignore
            const server = new WebpackDevServer(compiler, {
                https: {
                    key: ssl.key,
                    cert: ssl.cert
                },
                ...(project.experiments.webpack.hmr ? {
                    hot: true,
                    transportMode: 'ws',
                } : {}),
                proxy: {
                    '/': {
                        target: proxyUrl,
                        secure: false,
                        changeOrigin: true,
                        autoRewrite: true,
                        selfHandleResponse: true,
                        onProxyReq: (proxyReq) => {
                            if (cookieData) {
                                proxyReq.setHeader('cookie', cookieData);
                            }
                        },
                        onProxyRes: responseInterceptor(async (buffer, proxyRes, req, res) => {
                            const proxyCookie = proxyRes.headers['set-cookie'];
                            if (proxyCookie) {
                                cookieData = proxyCookie;
                            }

                            if ((proxyRes.headers['content-type'] || '').includes('text/html')) {
                                let response =  buffer.toString()
                                    .replace(new RegExp(proxyUrl, 'g'), 'https://green-pistachio.test:8080')
                                    .replace(
                                        new RegExp(
                                            proxyUrl.replace(':', '\\\\u003A').replace(/\//g, '\\\\u002F'),
                                            'g'
                                        ),
                                        'https://green-pistachio.test:8080'
                                    )
                                    .replace(
                                        new RegExp(
                                            proxyUrl.replace(/\//g, '\\\\/'),
                                            'g'
                                        ),
                                        'https://green-pistachio.test:8080'
                                    )

                                return response;
                            }

                            return buffer;
                        })
                    }
                }
            });

            server.listen(8080, 'green-pistachio.test', () => {
                logger('dev server started');
            });

            done();
        };
    }
}