import * as React from 'react';
import * as ReactDOMServer from 'react-dom/server';
import * as Dockerode from 'dockerode';
import * as os from 'os';

import { ONE_MINUTE } from '../api';
import { Shell } from './app-shell';
import { promiseRejections } from '../index';
import { humanSize, humanTime, percent, round } from './util';

import { state as apiState } from '../api';
import { BUILD_QUEUE } from '../builder';

const Docker = new Dockerode();

const Debug = (c: RenderContext) => {
    const memUsage = process.memoryUsage();
    const heapU = memUsage.heapUsed;
    const heapT = memUsage.heapTotal;
    const memTotal = os.totalmem();
    const memUsed = memTotal - os.freemem();
    const images = Array.from(apiState.localImages.entries()) as Array<[string, Dockerode.ImageInfo]>;

    const shortHash = (hash: string, length = 30) => <span title={hash}>{hash.slice(0, length)}…</span>;

    return (
        <Shell refreshInterval={ONE_MINUTE} startedServerAt={c.startedServerAt}>
            <style
                dangerouslySetInnerHTML={{
                    __html: `
                    .dserve-debug-cards {
                        display: flex;
                        flex-direction: row;
                        align-content: flex-start;
                        justify-content: flex-start;
                        flex-wrap: wrap;
                    }

                    .dserve-debug-cards figure {
                        border: 1px solid gray;
                        border-radius: 4px;
                        padding: 8px;
                        margin-bottom: auto;
                    }

                    .dserve-debug-cards figure figcaption {
                        border: 1px solid gray;
                        border-radius: 2px;
                        padding: 4px;
                        display: inline;
                    }

                    .dserve-debug-cards strong {
                        color: #00d8ff;
                    }

                    .dserve-container-list li ,
                    .dserve-image-list li {
                        margin-bottom: 8px;
                    }

                    .dserve-container-list li.created strong:before {
                        content: '🈺 ';
                    }

                    .dserve-container-list li.exited strong:before {
                        content: '🈵 ';
                    }

                    .dserve-container-list li.running strong:before {
                        content: '✅ ';
                    }
                    `,
                }}
            />
            <div className="dserve-debug-cards">
                <figure>
                    <p>CPU (x{os.cpus().length}): {os.loadavg().map(a => round(a, 2)).join(', ')} (1m, 5m, 15m)</p>
                    <p>Memory</p>
                    <ul>
                        <li>heap: {humanSize(heapU)} / {humanSize(heapT)} ({percent(heapU, heapT)}%)</li>
                        <li>system: {humanSize(memUsed)} / {humanSize(memTotal)} ({percent(memUsed, memTotal)}%)</li>
                    </ul>
                    <figcaption>System Load</figcaption>
                </figure>

                <figure>
                    <p>Build Queue</p>
                    {BUILD_QUEUE.length ? (
                        <ul>
                            {BUILD_QUEUE.map(hash => <li>{hash}</li>)}
                        </ul>
                    ) : (
                            <p><em>Nothing is waiting in the queue</em></p>
                        )}
                    <figcaption>Builder</figcaption>
                </figure>

                <figure>
                    {promiseRejections.size ? (
                        <ul>
                            {Array.from(promiseRejections.values()).map(([ts, reason,]) => (
                                <li>
                                    <time dateTime={ts.toISOString()} title={ts.toLocaleTimeString(undefined, { timeZoneName: 'long', hour12: true })}>
                                        {humanTime(ts.getTime() / 1000)}
                                    </time>
                                    {reason}
                                </li>
                            ))}
                        </ul>
                    ) : (
                            <p><em>No unhandled rejected promises</em></p>
                        )}
                    <figcaption>Rejected Promises</figcaption>
                </figure>

                <figure>
                    <p>Containers</p>
                    <ul>
                        {Array.from(apiState.containers.entries()).map(([key, info]) => (
                            <li key={info.Id} className={info.State}>
                                <strong>{info.Names}</strong> - {shortHash(info.Id)}<br />
                                Image ID: {shortHash(info.ImageID)}<br />
                                Status: {info.Status}
                            </li>
                        ))}
                    </ul>

                    <p>Images</p>
                    <p>Total storage size: {humanSize(images.reduce((size, [, info]) => size + info.Size, 0))}</p>
                    <ul>
                        {images.map(([key, info]) => (
                            <li key={info.Id}>
                                RepoTags: <strong>{shortHash(info.RepoTags.join(', '), 38)}</strong><br />
                                Id: {shortHash(info.Id)}<br />
                                Size: {humanSize(info.Size)}<br />
                                Created: {humanTime(info.Created)}
                            </li>
                        ))}
                    </ul>

                    <figcaption>API</figcaption>
                </figure>

                <figure>
                    <p>Containers</p>
                    <ul className="dserve-container-list">
                        {(
                            c.docker.containers
                                .sort((a, b) => b.Created - a.Created)
                                .map(info => (
                                    <li key={info.Id} className={info.State}>
                                        <strong>{info.Names}</strong> - {shortHash(info.Id)}<br />
                                        Image ID: {shortHash(info.ImageID)}<br />
                                        Status: {info.State} - {info.Status}
                                    </li>
                                ))
                        )}
                    </ul>

                    <p>Images</p>
                    <ul className="dserve-image-list">
                        {(
                            c.docker.images
                                .sort((a, b) => b.Created - a.Created)
                                .map(info => (
                                    <li key={info.Id}>
                                        RepoTags: <strong>{shortHash(info.RepoTags.join(', '), 38)}</strong><br />
                                        Id: {shortHash(info.Id)}<br />
                                        Size: {humanSize(info.Size)}<br />
                                        Created: {humanTime(info.Created)}
                                    </li>
                                ))
                        )}
                    </ul>
                    <figcaption>Docker</figcaption>
                </figure>
            </div>
        </Shell>
    );
};

type RenderContext = {
    startedServerAt: Date;
    docker: {
        containers: Array<Dockerode.ContainerInfo>;
        images: Array<Dockerode.ImageInfo>;
    };
}

export default async function renderDebug({ startedServerAt }: { startedServerAt: Date }) {
    return ReactDOMServer.renderToStaticMarkup((
        <Debug
            startedServerAt={startedServerAt}
            docker={{
                containers: await Docker.listContainers({ all: true }),
                images: await Docker.listImages(),
            }}
        />
    ));
}
